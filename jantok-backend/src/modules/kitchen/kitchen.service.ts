import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  InventoryReservationStatus,
  PackingItemStatus,
  PackingTaskStatus,
  Prisma,
  ProductionLineStatus,
  ProductionRevisionKind,
  ProductionRevisionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  ConfirmProductionDto,
  GenerateProductionDto,
  PackingItemDto,
  PackingTaskDto,
  ProductionLineActualDto,
} from './kitchen.dto.js';
import { normalizeQuantity } from './inventory-policy.js';
import { productionVariantKey, stableJson } from './production-policy.js';

type JsonMap = Record<string, unknown>;
type AggregateLine = {
  lineKind: 'MEAL' | 'ADDON';
  itemId: string;
  itemCode: string;
  variantKey: string;
  portionKey: string;
  plannedQuantity: number;
  itemSnapshot: JsonMap;
  recipeSnapshot: JsonMap;
  modificationSnapshot: JsonMap;
  restrictionSnapshot: JsonMap;
  ingredients: Array<{ id: string; amount: number; unit: string }>;
};

const asMap = (value: Prisma.JsonValue): JsonMap => value as JsonMap;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class KitchenService {
  constructor(private readonly prisma: PrismaService) {}

  async list(serviceDate: string) {
    return this.prisma.productionRevision.findMany({
      where: { serviceDate: this.date(serviceDate) },
      include: {
        lines: { orderBy: [{ lineKind: 'asc' }, { itemCode: 'asc' }] },
        ingredientNeeds: { include: { ingredient: true } },
        reservations: true,
        packingTasks: {
          include: { items: true },
          orderBy: { createdAt: 'asc' },
        },
        productionRun: true,
        printDocuments: { orderBy: { generatedAt: 'desc' } },
      },
      orderBy: { revision: 'desc' },
    });
  }

  async generate(actorUserId: string, dto: GenerateProductionDto) {
    const prior = await this.prisma.productionRevision.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { lines: true, ingredientNeeds: true, packingTasks: true },
    });
    if (prior) return prior;
    const serviceDate = this.date(dto.serviceDate);
    const aggregate = await this.aggregate(serviceDate);
    if (aggregate.fulfillments.length === 0)
      throw new NotFoundException(
        'No payable household daily orders for this date',
      );
    const previous = await this.prisma.productionRevision.findFirst({
      where: {
        serviceDate,
        kind: {
          in: [ProductionRevisionKind.FINAL, ProductionRevisionKind.DELTA],
        },
        status: { not: ProductionRevisionStatus.CANCELLED },
      },
      include: { ingredientNeeds: true },
      orderBy: { revision: 'desc' },
    });
    const requestedFinal = dto.kind !== ProductionRevisionKind.FORECAST;
    if (
      requestedFinal &&
      aggregate.fulfillments.some((item) => item.status === 'SCHEDULED')
    )
      throw new UnprocessableEntityException({
        code: 'DAILY_ORDERS_NOT_LOCKED',
        message:
          'Final production requires every included household order to pass cutoff',
      });
    if (
      previous?.status === ProductionRevisionStatus.COMPLETED &&
      requestedFinal
    )
      throw new ConflictException({
        code: 'PRODUCTION_ALREADY_COMPLETED',
        message:
          'A completed production run requires an explicit separate compensation workflow',
      });
    const latest = await this.prisma.productionRevision.findFirst({
      where: { serviceDate },
      orderBy: { revision: 'desc' },
    });
    const kind =
      requestedFinal && previous ? ProductionRevisionKind.DELTA : dto.kind;
    const revisionNumber = (latest?.revision ?? 0) + 1;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production:${dto.serviceDate}`}))`;
      const created = await tx.productionRevision.create({
        data: {
          serviceDate,
          revision: revisionNumber,
          kind,
          status: requestedFinal
            ? ProductionRevisionStatus.LOCKED
            : ProductionRevisionStatus.DRAFT,
          basedOnRevisionId: previous?.id,
          idempotencyKey: dto.idempotencyKey,
          lockedAt: requestedFinal ? new Date() : null,
          actorUserId,
          reason: dto.reason,
          lines: {
            create: aggregate.lines.map((line) => ({
              lineKind: line.lineKind,
              itemId: line.itemId,
              itemCode: line.itemCode,
              variantKey: line.variantKey,
              portionKey: line.portionKey,
              plannedQuantity: line.plannedQuantity,
              itemSnapshot: json(line.itemSnapshot),
              recipeSnapshot: json({
                ...line.recipeSnapshot,
                ingredients: line.ingredients,
              }),
              modificationSnapshot: json(line.modificationSnapshot),
              restrictionSnapshot: json(line.restrictionSnapshot),
              estimatedCostKzt: line.estimatedCostKzt,
            })),
          },
          ingredientNeeds: {
            create: aggregate.needs.map((need) => ({
              ingredientId: need.ingredientId,
              requiredQuantity: need.quantity,
              canonicalUnit: need.unit,
              estimatedUnitCostKzt: need.unitCost,
              estimatedTotalKzt: need.quantity * need.unitCost,
              recipeSnapshot: json(need.components),
            })),
          },
        },
      });
      if (requestedFinal) {
        await this.reserve(tx, created.id, serviceDate, aggregate.needs);
        await this.createPackingTasks(tx, created.id, aggregate.fulfillments);
      }
      return tx.productionRevision.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          lines: true,
          ingredientNeeds: true,
          reservations: true,
          packingTasks: { include: { items: true } },
        },
      });
    });
  }

  async recordActual(
    actorUserId: string,
    lineId: string,
    dto: ProductionLineActualDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.productionLine.findUnique({
        where: { id: lineId },
        include: { revision: true },
      });
      if (!line) throw new NotFoundException('Production line not found');
      if (
        line.revision.status !== ProductionRevisionStatus.LOCKED &&
        line.revision.status !== ProductionRevisionStatus.IN_PROGRESS
      )
        throw new ConflictException('Production revision is not editable');
      const changed = await tx.productionLine.updateMany({
        where: { id: line.id, version: dto.expectedVersion },
        data: {
          actualQuantity: dto.actualQuantity,
          status: ProductionLineStatus.IN_PROGRESS,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({
          code: 'STALE_PRODUCTION_LINE',
          message: 'Production line changed on another device',
        });
      await tx.productionRevision.updateMany({
        where: {
          id: line.revisionId,
          status: ProductionRevisionStatus.LOCKED,
        },
        data: { status: ProductionRevisionStatus.IN_PROGRESS },
      });
      await tx.dailyFulfillment.updateMany({
        where: { serviceDate: line.revision.serviceDate, status: 'LOCKED' },
        data: { status: 'IN_PRODUCTION', version: { increment: 1 } },
      });
      await tx.dailyFulfillmentEvent.createMany({
        data: (
          await tx.dailyFulfillment.findMany({
            where: {
              serviceDate: line.revision.serviceDate,
              status: 'IN_PRODUCTION',
            },
            select: { id: true },
          })
        ).map((fulfillment) => ({
          fulfillmentId: fulfillment.id,
          idempotencyKey: `${dto.idempotencyKey}:fulfillment:${fulfillment.id}`,
          type: 'STATUS_TRANSITION',
          fromStatus: 'LOCKED' as const,
          toStatus: 'IN_PRODUCTION' as const,
          actorType: 'KITCHEN',
          actorUserId,
          reason: 'Production actual recording started',
        })),
        skipDuplicates: true,
      });
      return tx.productionLine.findUniqueOrThrow({ where: { id: line.id } });
    });
  }

  async confirmProduction(
    actorUserId: string,
    revisionId: string,
    dto: ConfirmProductionDto,
  ) {
    const duplicate = await this.prisma.productionRun.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { revision: true },
    });
    if (duplicate) return duplicate;
    return this.prisma.$transaction(async (tx) => {
      const revision = await tx.productionRevision.findUnique({
        where: { id: revisionId },
        include: { lines: true, ingredientNeeds: true },
      });
      if (!revision)
        throw new NotFoundException('Production revision not found');
      if (
        revision.status !== ProductionRevisionStatus.LOCKED &&
        revision.status !== ProductionRevisionStatus.IN_PROGRESS
      )
        throw new ConflictException('Production revision cannot be confirmed');
      const later = await tx.productionRevision.findFirst({
        where: {
          serviceDate: revision.serviceDate,
          revision: { gt: revision.revision },
          status: { not: ProductionRevisionStatus.CANCELLED },
        },
      });
      if (later)
        throw new ConflictException(
          'Only the latest production revision can be confirmed',
        );
      const actualNeeds = await this.actualNeeds(tx, revision.lines);
      const activeReservations = await tx.inventoryReservation.findMany({
        where: {
          status: InventoryReservationStatus.ACTIVE,
          revision: { serviceDate: revision.serviceDate },
        },
      });
      const location = await this.mainLocation(tx);
      const ingredientIds = new Set([
        ...actualNeeds.keys(),
        ...activeReservations.map((item) => item.ingredientId),
      ]);
      let totalCost = 0;
      const lineCosts = new Map<string, number>();
      for (const ingredientId of [...ingredientIds].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ingredientId}:${location.id}`}))`;
        const balance = await tx.inventoryBalance.upsert({
          where: {
            ingredientId_storageLocationId: {
              ingredientId,
              storageLocationId: location.id,
            },
          },
          create: { ingredientId, storageLocationId: location.id },
          update: {},
        });
        const actual = actualNeeds.get(ingredientId)?.quantity ?? 0;
        const reserved = activeReservations
          .filter((item) => item.ingredientId === ingredientId)
          .reduce((sum, item) => sum + Number(item.quantity), 0);
        const changed = await tx.inventoryBalance.updateMany({
          where: {
            id: balance.id,
            onHandQuantity: { gte: actual },
            reservedQuantity: { gte: Math.max(0, reserved) },
          },
          data: {
            onHandQuantity: { decrement: actual },
            reservedQuantity: { decrement: reserved },
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ConflictException({
            code: 'INSUFFICIENT_INVENTORY',
            message: `Insufficient inventory for ingredient ${ingredientId}`,
          });
        const cost = actual * Number(balance.averageCostKzt);
        totalCost += cost;
        for (const component of actualNeeds.get(ingredientId)?.components ??
          []) {
          const variantKey = String(component.variantKey);
          lineCosts.set(
            variantKey,
            (lineCosts.get(variantKey) ?? 0) +
              Number(component.quantity) * Number(balance.averageCostKzt),
          );
        }
        if (actual > 0)
          await tx.inventoryMovement.create({
            data: {
              ingredientId,
              type: InventoryMovementType.PRODUCTION,
              quantity: actual,
              canonicalUnit: actualNeeds.get(ingredientId)!.unit,
              sourceLocationId: location.id,
              unitCostKzt: balance.averageCostKzt,
              totalCostKzt: cost,
              idempotencyKey: `production:${dto.idempotencyKey}:${ingredientId}`,
              referenceType: 'PRODUCTION_REVISION',
              referenceId: revision.id,
              actorUserId,
              shiftCode: dto.shiftCode,
              recipeSnapshot: json(
                actualNeeds.get(ingredientId)?.components ?? [],
              ),
            },
          });
        await tx.productionIngredientNeed.updateMany({
          where: { revisionId: revision.id, ingredientId },
          data: {
            actualQuantity: actual,
            actualUnitCostKzt: balance.averageCostKzt,
            actualTotalKzt: cost,
          },
        });
      }
      for (const line of revision.lines)
        await tx.productionLine.update({
          where: { id: line.id },
          data: {
            actualCostKzt: lineCosts.get(line.variantKey) ?? 0,
            status: ProductionLineStatus.READY,
          },
        });
      await tx.inventoryReservation.updateMany({
        where: {
          status: InventoryReservationStatus.ACTIVE,
          revision: { serviceDate: revision.serviceDate },
        },
        data: { status: InventoryReservationStatus.CONSUMED },
      });
      await tx.productionRevision.update({
        where: { id: revision.id },
        data: {
          status: ProductionRevisionStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
      await tx.dailyFulfillment.updateMany({
        where: {
          serviceDate: revision.serviceDate,
          status: { in: ['LOCKED', 'IN_PRODUCTION'] },
        },
        data: { status: 'COOKED', version: { increment: 1 } },
      });
      return tx.productionRun.create({
        data: {
          revisionId: revision.id,
          idempotencyKey: dto.idempotencyKey,
          actorUserId,
          shiftCode: dto.shiftCode,
          totalCostKzt: totalCost,
        },
        include: { revision: true },
      });
    });
  }

  async startPacking(actorUserId: string, taskId: string, dto: PackingTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.packingTask.findUniqueOrThrow({
        where: { id: taskId },
        include: { fulfillment: true },
      });
      if (task.status === PackingTaskStatus.IN_PROGRESS) return task;
      const changed = await tx.packingTask.updateMany({
        where: {
          id: task.id,
          status: PackingTaskStatus.PENDING,
          version: dto.expectedVersion,
        },
        data: {
          status: PackingTaskStatus.IN_PROGRESS,
          startedAt: new Date(),
          actorUserId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Packing task was changed concurrently');
      if (task.fulfillment.status === 'COOKED')
        await tx.dailyFulfillment.update({
          where: { id: task.fulfillmentId },
          data: { status: 'PACKING', version: { increment: 1 } },
        });
      await tx.dailyFulfillmentEvent.create({
        data: {
          fulfillmentId: task.fulfillmentId,
          idempotencyKey: dto.idempotencyKey,
          type: 'PACKING_STARTED',
          fromStatus: task.fulfillment.status,
          toStatus: 'PACKING',
          actorType: 'KITCHEN',
          actorUserId,
          reason: 'Packing task started',
        },
      });
      return tx.packingTask.findUniqueOrThrow({ where: { id: task.id } });
    });
  }

  async packItem(actorUserId: string, itemId: string, dto: PackingItemDto) {
    const changed = await this.prisma.packingItem.updateMany({
      where: { id: itemId, version: dto.expectedVersion },
      data: {
        status: dto.status,
        packedAt: dto.status === PackingItemStatus.PACKED ? new Date() : null,
        packedByUserId:
          dto.status === PackingItemStatus.PACKED ? actorUserId : null,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw new ConflictException('Packing item was changed concurrently');
    return this.prisma.packingItem.findUniqueOrThrow({ where: { id: itemId } });
  }

  async completePacking(
    actorUserId: string,
    taskId: string,
    dto: PackingTaskDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.packingTask.findUnique({
        where: { id: taskId },
        include: { items: true, fulfillment: true },
      });
      if (!task) throw new NotFoundException('Packing task not found');
      if (task.status === PackingTaskStatus.COMPLETE) return task;
      const incomplete = task.items.filter(
        (item) => item.status !== PackingItemStatus.PACKED,
      );
      if (incomplete.length)
        throw new ConflictException({
          code: 'PACKING_INCOMPLETE',
          message: `${incomplete.length} packing items are not packed`,
        });
      if (task.fulfillment.status !== 'PACKING')
        throw new ConflictException('Household daily order is not in PACKING');
      const changed = await tx.packingTask.updateMany({
        where: { id: task.id, version: dto.expectedVersion },
        data: {
          status: PackingTaskStatus.COMPLETE,
          completedAt: new Date(),
          actorUserId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Packing task was changed concurrently');
      const fulfillment = await tx.dailyFulfillment.update({
        where: { id: task.fulfillmentId },
        data: { status: 'READY', version: { increment: 1 } },
      });
      const settings = await tx.deliverySettings.findFirst({
        orderBy: { version: 'desc' },
      });
      await tx.deliveryJob.upsert({
        where: { fulfillmentId: fulfillment.id },
        create: {
          fulfillmentId: fulfillment.id,
          idempotencyKey: `delivery:create:${fulfillment.id}:1`,
          dispatchAt: fulfillment.dispatchAt,
          nextAttemptAt: fulfillment.dispatchAt,
          maxAttempts: settings?.maxCreateRetries ?? 3,
        },
        update: {
          dispatchAt: fulfillment.dispatchAt,
          nextAttemptAt: fulfillment.dispatchAt,
          status: 'SCHEDULED',
        },
      });
      await tx.dailyFulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          idempotencyKey: dto.idempotencyKey,
          type: 'PACKING_COMPLETED',
          fromStatus: 'PACKING',
          toStatus: 'READY',
          actorType: 'KITCHEN',
          actorUserId,
          reason: 'Every packing item was confirmed',
        },
      });
      return tx.packingTask.findUniqueOrThrow({
        where: { id: task.id },
        include: { items: true, fulfillment: true },
      });
    });
  }

  private async aggregate(serviceDate: Date) {
    const fulfillments = await this.prisma.dailyFulfillment.findMany({
      where: {
        serviceDate,
        status: { notIn: ['SKIPPED', 'CANCELLED', 'DELIVERY_FAILED'] },
        financialStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
      },
      include: {
        household: { include: { owner: true } },
        mealOrders: {
          include: {
            lines: true,
            participant: {
              include: {
                member: {
                  include: { allergies: { include: { allergen: true } } },
                },
                guest: true,
              },
            },
          },
        },
        serviceDay: {
          include: {
            standaloneAddonOrders: {
              where: { status: 'PLANNED' },
              include: {
                addon: {
                  include: { ingredients: { include: { ingredient: true } } },
                },
                participant: { include: { member: true, guest: true } },
              },
            },
            recurringAddonAllocations: {
              where: { status: 'PLANNED' },
              include: {
                plan: {
                  include: {
                    addon: {
                      include: {
                        ingredients: { include: { ingredient: true } },
                      },
                    },
                    participant: { include: { member: true, guest: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const lines = new Map<string, AggregateLine>();
    const referencedAddonQuantities = new Map<string, number>();
    for (const fulfillment of fulfillments) {
      for (const order of fulfillment.mealOrders) {
        for (const orderLine of order.lines) {
          const meal = asMap(orderLine.mealSnapshot);
          const recipe = asMap(orderLine.recipeSnapshot);
          const modification = asMap(orderLine.modificationSnapshot);
          const nutrition = asMap(orderLine.nutritionSnapshot);
          const memberAllergens =
            order.participant.member?.allergies.map(
              (allergy) => allergy.allergen?.code ?? allergy.freeText,
            ) ?? [];
          const guestAllergies = order.participant.guest
            ? asMap(order.participant.guest.allergySnapshot)
            : {};
          const restriction = {
            memberAllergens,
            guestAllergies,
            removedIngredientIds: modification.removedIngredientIds ?? [],
            addedIngredientIds: modification.addedIngredientIds ?? [],
          };
          const portionKey = `weight:${nutrition.weightGrams ?? 'unknown'}`;
          const variant = {
            lineKind: 'MEAL',
            itemId: meal.id,
            recipe,
            modification,
            portionKey,
            restriction,
          };
          const variantKey = productionVariantKey(variant);
          const ingredients = ((recipe.ingredients as JsonMap[]) ?? []).map(
            (ingredient) => ({
              id: String(ingredient.id),
              amount: Number(ingredient.amount ?? ingredient.grams ?? 0),
              unit: String(ingredient.unit ?? 'g'),
            }),
          );
          const current = lines.get(variantKey);
          if (current) current.plannedQuantity += 1;
          else
            lines.set(variantKey, {
              lineKind: 'MEAL',
              itemId: String(meal.id),
              itemCode: String(meal.code),
              variantKey,
              portionKey,
              plannedQuantity: 1,
              itemSnapshot: meal,
              recipeSnapshot: recipe,
              modificationSnapshot: modification,
              restrictionSnapshot: restriction,
              ingredients,
            });
          for (const addonId of (modification.addonIds as string[]) ?? [])
            referencedAddonQuantities.set(
              addonId,
              (referencedAddonQuantities.get(addonId) ?? 0) + 1,
            );
        }
      }
      for (const order of fulfillment.serviceDay.standaloneAddonOrders)
        this.addAddonLine(lines, order.addon, order.quantity);
      for (const allocation of fulfillment.serviceDay.recurringAddonAllocations)
        this.addAddonLine(lines, allocation.plan.addon, allocation.quantity);
    }
    if (referencedAddonQuantities.size) {
      const addons = await this.prisma.addon.findMany({
        where: { id: { in: [...referencedAddonQuantities.keys()] } },
        include: { ingredients: { include: { ingredient: true } } },
      });
      for (const addon of addons)
        this.addAddonLine(
          lines,
          addon,
          referencedAddonQuantities.get(addon.id) ?? 0,
        );
    }
    const ingredients = await this.prisma.ingredient.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              [...lines.values()].flatMap((line) =>
                line.ingredients.map((item) => item.id),
              ),
            ),
          ],
        },
      },
      include: { inventoryBalances: true },
    });
    const policies = new Map(ingredients.map((item) => [item.id, item]));
    const needs = new Map<
      string,
      {
        ingredientId: string;
        quantity: number;
        unit: string;
        unitCost: number;
        components: JsonMap[];
      }
    >();
    for (const line of lines.values()) {
      let lineCost = 0;
      for (const component of line.ingredients) {
        const ingredient = policies.get(component.id);
        if (!ingredient)
          throw new BadRequestException(
            `Ingredient ${component.id} is unavailable`,
          );
        const yieldFactor = Number(line.recipeSnapshot.yieldFactor ?? 1);
        const lossFactor = Number(line.recipeSnapshot.lossFactor ?? 0);
        const perPortion =
          normalizeQuantity(
            {
              inventoryDimension: ingredient.inventoryDimension,
              inventoryUnit: ingredient.inventoryUnit,
              densityGramsPerMl: ingredient.densityGramsPerMl
                ? Number(ingredient.densityGramsPerMl)
                : null,
            },
            component.amount,
            component.unit,
          ) *
          ((1 + lossFactor) / yieldFactor);
        const quantity = perPortion * line.plannedQuantity;
        const unitCost = Number(
          ingredient.inventoryBalances[0]?.averageCostKzt ?? 0,
        );
        lineCost += quantity * unitCost;
        const current = needs.get(ingredient.id) ?? {
          ingredientId: ingredient.id,
          quantity: 0,
          unit: ingredient.inventoryUnit,
          unitCost,
          components: [],
        };
        current.quantity += quantity;
        current.components.push({
          variantKey: line.variantKey,
          itemCode: line.itemCode,
          portions: line.plannedQuantity,
          perPortion,
        });
        needs.set(ingredient.id, current);
      }
      (line as AggregateLine & { estimatedCostKzt: number }).estimatedCostKzt =
        lineCost;
    }
    return {
      fulfillments,
      lines: [...lines.values()] as Array<
        AggregateLine & { estimatedCostKzt: number }
      >,
      needs: [...needs.values()],
    };
  }

  private addAddonLine(
    lines: Map<string, AggregateLine>,
    addon: {
      id: string;
      code: string;
      nameRu: string;
      unit: string;
      ingredients: Array<{
        amount: Prisma.Decimal;
        unit: string;
        ingredient: { id: string };
      }>;
    },
    quantity: number,
  ) {
    const variant = { lineKind: 'ADDON', itemId: addon.id, unit: addon.unit };
    const variantKey = productionVariantKey(variant);
    const current = lines.get(variantKey);
    if (current) current.plannedQuantity += quantity;
    else
      lines.set(variantKey, {
        lineKind: 'ADDON',
        itemId: addon.id,
        itemCode: addon.code,
        variantKey,
        portionKey: addon.unit,
        plannedQuantity: quantity,
        itemSnapshot: { id: addon.id, code: addon.code, nameRu: addon.nameRu },
        recipeSnapshot: { recipeVersion: 1, yieldFactor: 1, lossFactor: 0 },
        modificationSnapshot: {},
        restrictionSnapshot: {},
        ingredients: addon.ingredients.map((item) => ({
          id: item.ingredient.id,
          amount: Number(item.amount),
          unit: item.unit,
        })),
      });
  }

  private async reserve(
    tx: Prisma.TransactionClient,
    revisionId: string,
    serviceDate: Date,
    needs: Array<{
      ingredientId: string;
      quantity: number;
      unit: string;
    }>,
  ) {
    const location = await this.mainLocation(tx);
    const active = await tx.inventoryReservation.findMany({
      where: {
        status: InventoryReservationStatus.ACTIVE,
        revision: { serviceDate },
      },
    });
    const requested = new Map(needs.map((need) => [need.ingredientId, need]));
    const ingredientIds = new Set([
      ...requested.keys(),
      ...active.map((reservation) => reservation.ingredientId),
    ]);
    for (const ingredientId of [...ingredientIds].sort()) {
      const need = requested.get(ingredientId) ?? {
        ingredientId,
        quantity: 0,
        unit: '',
      };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${need.ingredientId}:${location.id}`}))`;
      const balance = await tx.inventoryBalance.upsert({
        where: {
          ingredientId_storageLocationId: {
            ingredientId: need.ingredientId,
            storageLocationId: location.id,
          },
        },
        create: {
          ingredientId: need.ingredientId,
          storageLocationId: location.id,
        },
        update: {},
      });
      const alreadyReserved = active
        .filter((item) => item.ingredientId === need.ingredientId)
        .reduce((sum, item) => sum + Number(item.quantity), 0);
      const delta = need.quantity - alreadyReserved;
      if (
        Number(balance.reservedQuantity) + delta < -0.0001 ||
        Number(balance.onHandQuantity) - Number(balance.reservedQuantity) <
          delta - 0.0001
      )
        throw new ConflictException({
          code: 'INSUFFICIENT_AVAILABLE_INVENTORY',
          message: `Insufficient available inventory for ${need.ingredientId}`,
        });
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          reservedQuantity: { increment: delta },
          version: { increment: 1 },
        },
      });
      await tx.inventoryReservation.create({
        data: {
          revisionId,
          ingredientId: need.ingredientId,
          storageLocationId: location.id,
          quantity: delta,
          idempotencyKey: `reservation:${revisionId}:${need.ingredientId}`,
        },
      });
    }
  }

  private async actualNeeds(
    tx: Prisma.TransactionClient,
    lines: Array<{
      variantKey: string;
      itemCode: string;
      plannedQuantity: number;
      actualQuantity: number | null;
      recipeSnapshot: Prisma.JsonValue;
    }>,
  ) {
    const components = lines.flatMap((line) => {
      const recipe = asMap(line.recipeSnapshot);
      return ((recipe.ingredients as JsonMap[]) ?? []).map((item) => ({
        line,
        recipe,
        id: String(item.id),
        amount: Number(item.amount ?? item.grams ?? 0),
        unit: String(item.unit ?? 'g'),
      }));
    });
    const ingredients = await tx.ingredient.findMany({
      where: { id: { in: [...new Set(components.map((item) => item.id))] } },
    });
    const byId = new Map(ingredients.map((item) => [item.id, item]));
    const needs = new Map<
      string,
      { quantity: number; unit: string; components: JsonMap[] }
    >();
    for (const component of components) {
      const ingredient = byId.get(component.id)!;
      const quantity =
        normalizeQuantity(
          {
            inventoryDimension: ingredient.inventoryDimension,
            inventoryUnit: ingredient.inventoryUnit,
            densityGramsPerMl: ingredient.densityGramsPerMl
              ? Number(ingredient.densityGramsPerMl)
              : null,
          },
          component.amount,
          component.unit,
        ) *
        (component.line.actualQuantity ?? component.line.plannedQuantity) *
        ((1 + Number(component.recipe.lossFactor ?? 0)) /
          Number(component.recipe.yieldFactor ?? 1));
      const current = needs.get(ingredient.id) ?? {
        quantity: 0,
        unit: ingredient.inventoryUnit,
        components: [],
      };
      current.quantity += quantity;
      current.components.push({
        variantKey: component.line.variantKey,
        itemCode: component.line.itemCode,
        actualPortions:
          component.line.actualQuantity ?? component.line.plannedQuantity,
        quantity,
      });
      needs.set(ingredient.id, current);
    }
    return needs;
  }

  private async createPackingTasks(
    tx: Prisma.TransactionClient,
    revisionId: string,
    fulfillments: Awaited<
      ReturnType<KitchenService['aggregate']>
    >['fulfillments'],
  ) {
    for (const fulfillment of fulfillments) {
      const items: Array<{
        dailyOrderLineId?: string;
        itemType: string;
        itemKey: string;
        memberSnapshot: JsonMap;
        contentSnapshot: JsonMap;
        restrictionLabel?: string;
        quantity: number;
      }> = [];
      for (const order of fulfillment.mealOrders) {
        const participantName =
          order.participant.member?.firstName ??
          order.participant.guest?.displayName ??
          'Guest';
        for (const line of order.lines) {
          const modifications = asMap(line.modificationSnapshot);
          const meal = asMap(line.mealSnapshot);
          const recipe = asMap(line.recipeSnapshot);
          const nutrition = asMap(line.nutritionSnapshot);
          const memberAllergens =
            order.participant.member?.allergies.map(
              (allergy) => allergy.allergen?.code ?? allergy.freeText,
            ) ?? [];
          const guestAllergies = order.participant.guest
            ? asMap(order.participant.guest.allergySnapshot)
            : {};
          const portionKey = `weight:${nutrition.weightGrams ?? 'unknown'}`;
          const variantKey = productionVariantKey({
            lineKind: 'MEAL',
            itemId: meal.id,
            recipe,
            modification: modifications,
            portionKey,
            restriction: {
              memberAllergens,
              guestAllergies,
              removedIngredientIds: modifications.removedIngredientIds ?? [],
              addedIngredientIds: modifications.addedIngredientIds ?? [],
            },
          });
          const hasRestrictions = Object.values(modifications).some(
            (value) => Array.isArray(value) && value.length > 0,
          );
          items.push({
            dailyOrderLineId: line.id,
            itemType: 'MEAL',
            itemKey: `meal:${line.id}`,
            memberSnapshot: {
              participantId: order.participantId,
              displayName: participantName,
            },
            contentSnapshot: {
              mealType: line.mealType,
              meal: line.mealSnapshot,
              modifications,
              variantKey,
            },
            restrictionLabel: hasRestrictions
              ? `INDIVIDUAL: ${stableJson(modifications)}`.slice(0, 500)
              : undefined,
            quantity: 1,
          });
        }
      }
      for (const order of fulfillment.serviceDay.standaloneAddonOrders) {
        const name =
          order.participant.member?.firstName ??
          order.participant.guest?.displayName ??
          'Household';
        items.push({
          itemType: 'ADDON',
          itemKey: `standalone-addon:${order.id}`,
          memberSnapshot: {
            participantId: order.participantId,
            displayName: name,
          },
          contentSnapshot: {
            ...asMap(order.addonSnapshot),
            variantKey: productionVariantKey({
              lineKind: 'ADDON',
              itemId: order.addon.id,
              unit: order.addon.unit,
            }),
          },
          quantity: order.quantity,
        });
      }
      for (const allocation of fulfillment.serviceDay
        .recurringAddonAllocations) {
        const name =
          allocation.plan.participant?.member?.firstName ??
          allocation.plan.participant?.guest?.displayName ??
          'Household';
        items.push({
          itemType: 'ADDON',
          itemKey: `recurring-addon:${allocation.id}`,
          memberSnapshot: {
            participantId: allocation.plan.participantId,
            displayName: name,
          },
          contentSnapshot: {
            addonId: allocation.plan.addon.id,
            code: allocation.plan.addon.code,
            nameRu: allocation.plan.addon.nameRu,
            variantKey: productionVariantKey({
              lineKind: 'ADDON',
              itemId: allocation.plan.addon.id,
              unit: allocation.plan.addon.unit,
            }),
          },
          quantity: allocation.quantity,
        });
      }
      await tx.packingTask.create({
        data: {
          revisionId,
          fulfillmentId: fulfillment.id,
          householdSnapshot: {
            householdId: fulfillment.householdId,
            customerName: [
              fulfillment.household.owner.firstName,
              fulfillment.household.owner.lastName,
            ]
              .filter(Boolean)
              .join(' '),
          },
          orderSnapshot: {
            dailyOrderId: fulfillment.id,
            serviceDate: fulfillment.serviceDate.toISOString().slice(0, 10),
            address: fulfillment.addressSnapshot,
            slot: fulfillment.slotSnapshot,
          },
          items: {
            create: items.map((item) => ({
              ...item,
              memberSnapshot: json(item.memberSnapshot),
              contentSnapshot: json(item.contentSnapshot),
            })),
          },
        },
      });
    }
  }

  private mainLocation(tx: Prisma.TransactionClient) {
    return tx.storageLocation.upsert({
      where: { code: 'MAIN' },
      create: { code: 'MAIN', name: 'Основной склад кухни' },
      update: {},
    });
  }

  private date(value: string) {
    const result = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(result.valueOf()))
      throw new BadRequestException('Invalid date');
    return result;
  }
}

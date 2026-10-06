import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  InventoryMovementDto,
  ReceivePurchaseItemDto,
  SupplierDto,
  SupplierPurchaseDto,
  WasteDto,
} from './kitchen.dto.js';
import { normalizeQuantity, weightedAverageCost } from './inventory-policy.js';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.ingredient.findMany({
      include: {
        allergens: { include: { allergen: true } },
        inventoryBalances: { include: { storageLocation: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  listSuppliers() {
    return this.prisma.supplier.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  listPurchases() {
    return this.prisma.supplierPurchase.findMany({
      include: {
        supplier: true,
        items: {
          include: { ingredient: true, storageLocation: true },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  upsertSupplier(dto: SupplierDto) {
    const code = dto.code.trim().toUpperCase();
    return this.prisma.supplier.upsert({
      where: { code },
      create: { ...dto, code },
      update: dto,
    });
  }

  async createPurchase(actorUserId: string, dto: SupplierPurchaseDto) {
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: dto.items.map((item) => item.ingredientId) } },
    });
    const byId = new Map(ingredients.map((item) => [item.id, item]));
    if (
      ingredients.length !==
      new Set(dto.items.map((item) => item.ingredientId)).size
    )
      throw new NotFoundException('At least one ingredient was not found');
    return this.prisma.supplierPurchase.create({
      data: {
        supplierId: dto.supplierId,
        number: dto.number.trim(),
        status: PurchaseOrderStatus.ORDERED,
        orderedAt: new Date(),
        actorUserId,
        items: {
          create: dto.items.map((item) => {
            const ingredient = byId.get(item.ingredientId)!;
            const canonicalQuantity = normalizeQuantity(
              this.unitPolicy(ingredient),
              item.quantity,
              item.unit,
            );
            const unitPriceCanonical =
              (item.unitPriceKzt * item.quantity) / canonicalQuantity;
            return {
              ingredientId: item.ingredientId,
              storageLocationId: item.storageLocationId,
              orderedQuantity: item.quantity,
              inputUnit: item.unit,
              canonicalQuantity,
              unitPriceKzt: unitPriceCanonical,
            };
          }),
        },
      },
      include: { items: true, supplier: true },
    });
  }

  async receivePurchaseItem(
    actorUserId: string,
    itemId: string,
    dto: ReceivePurchaseItemDto,
  ) {
    const duplicate = await this.prisma.inventoryMovement.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (duplicate)
      return this.prisma.supplierPurchaseItem.findUniqueOrThrow({
        where: { id: itemId },
      });
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.supplierPurchaseItem.findUnique({
        where: { id: itemId },
        include: { ingredient: true, purchase: { include: { items: true } } },
      });
      if (!item) throw new NotFoundException('Purchase item not found');
      const quantity = normalizeQuantity(
        this.unitPolicy(item.ingredient),
        dto.quantity,
        dto.unit,
      );
      if (
        Number(item.receivedQuantity) + quantity >
        Number(item.canonicalQuantity) + 0.0001
      )
        throw new ConflictException('Receipt exceeds ordered quantity');
      await this.lockBalance(tx, item.ingredientId, item.storageLocationId);
      const balance = await this.balance(
        tx,
        item.ingredientId,
        item.storageLocationId,
      );
      const nextAverage = weightedAverageCost(
        Number(balance.onHandQuantity),
        Number(balance.averageCostKzt),
        quantity,
        Number(item.unitPriceKzt),
      );
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          onHandQuantity: { increment: quantity },
          averageCostKzt: nextAverage,
          version: { increment: 1 },
        },
      });
      await tx.inventoryMovement.create({
        data: {
          ingredientId: item.ingredientId,
          type: InventoryMovementType.PURCHASE,
          quantity,
          canonicalUnit: item.ingredient.inventoryUnit,
          targetLocationId: item.storageLocationId,
          unitCostKzt: item.unitPriceKzt,
          totalCostKzt: quantity * Number(item.unitPriceKzt),
          idempotencyKey: dto.idempotencyKey,
          referenceType: 'SUPPLIER_PURCHASE_ITEM',
          referenceId: item.id,
          actorUserId,
        },
      });
      const updated = await tx.supplierPurchaseItem.update({
        where: { id: item.id },
        data: {
          receivedQuantity: { increment: quantity },
          receivedAt: new Date(),
        },
      });
      const totalExpected = item.purchase.items.reduce(
        (sum, current) => sum + Number(current.canonicalQuantity),
        0,
      );
      const totalReceived =
        item.purchase.items.reduce(
          (sum, current) => sum + Number(current.receivedQuantity),
          0,
        ) + quantity;
      await tx.supplierPurchase.update({
        where: { id: item.purchaseId },
        data: {
          status:
            totalReceived + 0.0001 >= totalExpected
              ? PurchaseOrderStatus.RECEIVED
              : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          receivedAt:
            totalReceived + 0.0001 >= totalExpected ? new Date() : null,
        },
      });
      return updated;
    });
  }

  async recordWaste(actorUserId: string, dto: WasteDto) {
    const prior = await this.prisma.wasteEntry.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (prior) return prior;
    return this.prisma.$transaction(async (tx) => {
      const ingredient = await tx.ingredient.findUnique({
        where: { id: dto.ingredientId },
      });
      if (!ingredient) throw new NotFoundException('Ingredient not found');
      const quantity = normalizeQuantity(
        this.unitPolicy(ingredient),
        dto.quantity,
        dto.unit,
      );
      await this.lockBalance(tx, ingredient.id, dto.storageLocationId);
      const balance = await this.balance(
        tx,
        ingredient.id,
        dto.storageLocationId,
      );
      await this.consume(tx, balance.id, quantity, 0);
      const cost = quantity * Number(balance.averageCostKzt);
      const movement = await tx.inventoryMovement.create({
        data: {
          ingredientId: ingredient.id,
          type: InventoryMovementType.WASTE,
          quantity,
          canonicalUnit: ingredient.inventoryUnit,
          sourceLocationId: dto.storageLocationId,
          unitCostKzt: balance.averageCostKzt,
          totalCostKzt: cost,
          idempotencyKey: `movement:${dto.idempotencyKey}`,
          referenceType: 'WASTE_ENTRY',
          referenceId: dto.idempotencyKey,
          reason: dto.reason,
          actorUserId,
          shiftCode: dto.shiftCode,
        },
      });
      return tx.wasteEntry.create({
        data: {
          ingredientId: ingredient.id,
          movementId: movement.id,
          quantity,
          canonicalUnit: ingredient.inventoryUnit,
          costKzt: cost,
          reason: dto.reason,
          wasteDate: new Date(`${dto.wasteDate}T00:00:00.000Z`),
          actorUserId,
          shiftCode: dto.shiftCode,
          idempotencyKey: dto.idempotencyKey,
        },
      });
    });
  }

  async manualMovement(actorUserId: string, dto: InventoryMovementDto) {
    if (
      dto.type !== InventoryMovementType.CORRECTION &&
      dto.type !== InventoryMovementType.RETURN &&
      dto.type !== InventoryMovementType.TRANSFER
    )
      throw new BadRequestException(
        'Use the dedicated purchase, production, or waste command',
      );
    const prior = await this.prisma.inventoryMovement.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (prior) return prior;
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');
    const quantity = normalizeQuantity(
      this.unitPolicy(ingredient),
      dto.quantity,
      dto.unit,
    );
    if (
      dto.type === InventoryMovementType.TRANSFER &&
      (!dto.sourceLocationId ||
        !dto.targetLocationId ||
        dto.sourceLocationId === dto.targetLocationId)
    )
      throw new BadRequestException(
        'TRANSFER requires distinct source and target locations',
      );
    if (
      dto.type !== InventoryMovementType.TRANSFER &&
      Boolean(dto.sourceLocationId) === Boolean(dto.targetLocationId)
    )
      throw new BadRequestException(
        'CORRECTION/RETURN requires exactly one source or target',
      );
    return this.prisma.$transaction(async (tx) => {
      const ids = [dto.sourceLocationId, dto.targetLocationId]
        .filter(Boolean)
        .sort() as string[];
      for (const id of ids) await this.lockBalance(tx, ingredient.id, id);
      const source = dto.sourceLocationId
        ? await this.balance(tx, ingredient.id, dto.sourceLocationId)
        : null;
      const target = dto.targetLocationId
        ? await this.balance(tx, ingredient.id, dto.targetLocationId)
        : null;
      const unitCost = Number(
        source?.averageCostKzt ?? target?.averageCostKzt ?? 0,
      );
      if (source) await this.consume(tx, source.id, quantity, 0);
      if (target) {
        const nextAverage = weightedAverageCost(
          Number(target.onHandQuantity),
          Number(target.averageCostKzt),
          quantity,
          unitCost,
        );
        await tx.inventoryBalance.update({
          where: { id: target.id },
          data: {
            onHandQuantity: { increment: quantity },
            averageCostKzt: nextAverage,
            version: { increment: 1 },
          },
        });
      }
      return tx.inventoryMovement.create({
        data: {
          ingredientId: ingredient.id,
          type: dto.type,
          quantity,
          canonicalUnit: ingredient.inventoryUnit,
          sourceLocationId: dto.sourceLocationId,
          targetLocationId: dto.targetLocationId,
          unitCostKzt: unitCost,
          totalCostKzt: quantity * unitCost,
          idempotencyKey: dto.idempotencyKey,
          referenceType: 'MANUAL_ADJUSTMENT',
          referenceId: dto.idempotencyKey,
          reason: dto.reason,
          actorUserId,
        },
      });
    });
  }

  async costReport(from: string, to: string) {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    const [
      production,
      waste,
      purchaseRevenue,
      chargeRevenue,
      refunds,
      revisions,
    ] = await Promise.all([
      this.prisma.inventoryMovement.aggregate({
        where: {
          type: InventoryMovementType.PRODUCTION,
          occurredAt: { gte: fromDate, lte: toDate },
        },
        _sum: { totalCostKzt: true },
      }),
      this.prisma.wasteEntry.aggregate({
        where: { wasteDate: { gte: fromDate, lte: toDate } },
        _sum: { costKzt: true },
      }),
      this.prisma.purchase.aggregate({
        where: {
          status: 'PAID',
          paidAt: { gte: fromDate, lte: toDate },
        },
        _sum: { cashKzt: true, bonusKzt: true },
      }),
      this.prisma.subscriptionCharge.aggregate({
        where: {
          status: 'PAID',
          paidAt: { gte: fromDate, lte: toDate },
        },
        _sum: { cashKzt: true, bonusKzt: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          status: 'SUCCEEDED',
          authoritativeAt: { gte: fromDate, lte: toDate },
        },
        _sum: { cashKzt: true, bonusKzt: true },
      }),
      this.prisma.productionRevision.findMany({
        where: {
          serviceDate: { gte: fromDate, lte: toDate },
          status: { not: 'CANCELLED' },
        },
        include: {
          lines: true,
          ingredientNeeds: true,
          packingTasks: {
            include: {
              items: true,
              fulfillment: { select: { subscriptionId: true } },
            },
          },
        },
        orderBy: [{ serviceDate: 'asc' }, { revision: 'desc' }],
      }),
    ]);
    const productionCostKzt = Number(production._sum.totalCostKzt ?? 0);
    const wasteCostKzt = Number(waste._sum.costKzt ?? 0);
    const recognizedRevenueKzt =
      Number(purchaseRevenue._sum.cashKzt ?? 0) +
      Number(purchaseRevenue._sum.bonusKzt ?? 0) +
      Number(chargeRevenue._sum.cashKzt ?? 0) +
      Number(chargeRevenue._sum.bonusKzt ?? 0) -
      Number(refunds._sum.cashKzt ?? 0) -
      Number(refunds._sum.bonusKzt ?? 0);
    const totalFoodCostKzt = productionCostKzt + wasteCostKzt;
    const latestByDate = new Map<string, (typeof revisions)[number]>();
    for (const revision of revisions) {
      const key = revision.serviceDate.toISOString().slice(0, 10);
      if (!latestByDate.has(key)) latestByDate.set(key, revision);
    }
    const dishCosts = [...latestByDate.values()].flatMap((revision) =>
      revision.lines.map((line) => {
        const portions = line.actualQuantity ?? line.plannedQuantity;
        const totalKzt = Number(
          line.actualCostKzt ?? line.estimatedCostKzt ?? 0,
        );
        return {
          serviceDate: revision.serviceDate.toISOString().slice(0, 10),
          revision: revision.revision,
          itemCode: line.itemCode,
          variantKey: line.variantKey,
          portions,
          basis: line.actualCostKzt == null ? 'ESTIMATED' : 'ACTUAL',
          totalKzt,
          perPortionKzt: portions > 0 ? totalKzt / portions : 0,
        };
      }),
    );
    const dishByVariant = new Map(
      dishCosts.map((item) => [
        `${item.serviceDate}:${item.variantKey}`,
        item.perPortionKzt,
      ]),
    );
    const dailyKitCosts = [...latestByDate.values()].flatMap((revision) => {
      const serviceDate = revision.serviceDate.toISOString().slice(0, 10);
      return revision.packingTasks.map((task) => ({
        serviceDate,
        fulfillmentId: task.fulfillmentId,
        subscriptionId: task.fulfillment.subscriptionId,
        totalKzt: task.items.reduce((sum, item) => {
          const content = item.contentSnapshot as Record<string, unknown>;
          const unitCost = dishByVariant.get(
            `${serviceDate}:${String(content.variantKey ?? '')}`,
          );
          return sum + (unitCost ?? 0) * item.quantity;
        }, 0),
      }));
    });
    const paidCycleCostMap = new Map<string, number>();
    for (const kit of dailyKitCosts)
      paidCycleCostMap.set(
        kit.subscriptionId,
        (paidCycleCostMap.get(kit.subscriptionId) ?? 0) + kit.totalKzt,
      );
    const estimatedProductionCostKzt = [...latestByDate.values()].reduce(
      (sum, revision) =>
        sum +
        revision.ingredientNeeds.reduce(
          (nested, need) => nested + Number(need.estimatedTotalKzt),
          0,
        ),
      0,
    );
    return {
      from,
      to,
      productionCostKzt,
      estimatedProductionCostKzt,
      wasteCostKzt,
      totalFoodCostKzt,
      recognizedRevenueKzt,
      grossMarginKzt: recognizedRevenueKzt - totalFoodCostKzt,
      foodCostPercent:
        recognizedRevenueKzt > 0
          ? Number(((totalFoodCostKzt / recognizedRevenueKzt) * 100).toFixed(2))
          : null,
      dishCosts,
      dailyKitCosts,
      paidCycleCosts: [...paidCycleCostMap].map(
        ([subscriptionId, totalKzt]) => ({ subscriptionId, totalKzt }),
      ),
      policy:
        'Revenue is recognized by successful payment/refund date. Production and waste are actual costs; waste is sourced only from waste_entries and its linked movement is not summed again.',
    };
  }

  private unitPolicy(ingredient: {
    inventoryDimension: 'MASS' | 'VOLUME' | 'COUNT';
    inventoryUnit: string;
    densityGramsPerMl: Prisma.Decimal | null;
  }) {
    return {
      inventoryDimension: ingredient.inventoryDimension,
      inventoryUnit: ingredient.inventoryUnit,
      densityGramsPerMl: ingredient.densityGramsPerMl
        ? Number(ingredient.densityGramsPerMl)
        : null,
    };
  }

  private async lockBalance(
    tx: Prisma.TransactionClient,
    ingredientId: string,
    locationId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ingredientId}:${locationId}`}))`;
  }

  private async balance(
    tx: Prisma.TransactionClient,
    ingredientId: string,
    storageLocationId: string,
  ) {
    return tx.inventoryBalance.upsert({
      where: {
        ingredientId_storageLocationId: { ingredientId, storageLocationId },
      },
      create: { ingredientId, storageLocationId },
      update: {},
    });
  }

  private async consume(
    tx: Prisma.TransactionClient,
    balanceId: string,
    quantity: number,
    releaseReserved: number,
  ) {
    const updated = await tx.inventoryBalance.updateMany({
      where: {
        id: balanceId,
        onHandQuantity: { gte: quantity },
        reservedQuantity: { gte: releaseReserved },
      },
      data: {
        onHandQuantity: { decrement: quantity },
        reservedQuantity: { decrement: releaseReserved },
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new ConflictException({
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Inventory cannot become negative',
      });
  }
}

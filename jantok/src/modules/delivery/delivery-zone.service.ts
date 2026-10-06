import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeliveryConfigStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';

type Position = [longitude: number, latitude: number];
type PolygonGeometry = { type: 'Polygon'; coordinates: Position[][] };

function onSegment(point: Position, a: Position, b: Position) {
  const cross =
    (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
  return (
    Math.abs(cross) < 1e-10 &&
    point[0] >= Math.min(a[0], b[0]) &&
    point[0] <= Math.max(a[0], b[0]) &&
    point[1] >= Math.min(a[1], b[1]) &&
    point[1] <= Math.max(a[1], b[1])
  );
}

function insideRing(point: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    if (onSegment(point, a, b)) return true;
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Position, geometry: PolygonGeometry) {
  const [outer, ...holes] = geometry.coordinates;
  return Boolean(
    outer &&
    insideRing(point, outer) &&
    !holes.some((ring) => insideRing(point, ring)),
  );
}

function parsePolygon(value: unknown): PolygonGeometry {
  const geometry = value as Partial<PolygonGeometry>;
  if (
    geometry?.type !== 'Polygon' ||
    !Array.isArray(geometry.coordinates) ||
    !Array.isArray(geometry.coordinates[0]) ||
    geometry.coordinates[0].length < 4
  )
    throw new ServiceUnavailableException({
      code: 'DELIVERY_ZONE_INVALID',
      message: 'Configured delivery zone is not a valid GeoJSON Polygon',
    });
  return geometry as PolygonGeometry;
}

@Injectable()
export class DeliveryZoneService {
  constructor(private readonly prisma: PrismaService) {}

  async settings() {
    const allowed =
      process.env.APP_ENV === 'production'
        ? [DeliveryConfigStatus.ACTIVE]
        : [DeliveryConfigStatus.ACTIVE, DeliveryConfigStatus.DEMO];
    const settings = await this.prisma.deliverySettings.findFirst({
      where: { status: { in: allowed } },
      orderBy: [{ status: 'desc' }, { version: 'desc' }],
    });
    if (!settings)
      throw new ServiceUnavailableException({
        code: 'DELIVERY_SETTINGS_UNAVAILABLE',
        message: 'Delivery settings are not configured',
      });
    return settings;
  }

  async assertDeliverable(latitude: number, longitude: number) {
    const allowed =
      process.env.APP_ENV === 'production'
        ? [DeliveryConfigStatus.ACTIVE]
        : [DeliveryConfigStatus.ACTIVE, DeliveryConfigStatus.DEMO];
    const zone = await this.prisma.deliveryZone.findFirst({
      where: { status: { in: allowed } },
      orderBy: [{ status: 'desc' }, { version: 'desc' }],
    });
    if (!zone)
      throw new ServiceUnavailableException({
        code: 'DELIVERY_ZONE_UNAVAILABLE',
        message: 'A confirmed delivery polygon is required',
      });
    if (!pointInPolygon([longitude, latitude], parsePolygon(zone.geometry)))
      throw new UnprocessableEntityException({
        code: 'ADDRESS_OUTSIDE_DELIVERY_ZONE',
        message: 'Address is outside the configured delivery zone',
      });
    return zone;
  }
}

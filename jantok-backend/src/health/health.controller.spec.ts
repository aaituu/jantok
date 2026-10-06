import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  it('reports process liveness without checking dependencies', () => {
    const service = { checkReadiness: vi.fn() } as unknown as HealthService;
    const controller = new HealthController(service);

    expect(controller.live()).toMatchObject({
      status: 'ok',
      service: 'jantok-backend',
    });
    expect(service.checkReadiness).not.toHaveBeenCalled();
  });

  it('delegates readiness checks to the health service', async () => {
    const expected = { status: 'ok' };
    const service = {
      checkReadiness: vi.fn().mockResolvedValue(expected),
    } as unknown as HealthService;
    const controller = new HealthController(service);

    await expect(controller.ready()).resolves.toBe(expected);
  });
});

import { jwtVerify } from 'jose';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service.js';
import { SupportService } from './support.service.js';
import type { SendSupportMessageDto } from './support.dto.js';

type AuthenticatedSocket = Socket & {
  data: { auth?: { userId: string; employeeId?: string } };
};

@WebSocketGateway({
  namespace: '/support',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class SupportGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const header = client.handshake.headers.authorization;
    const token =
      (typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : undefined) ?? header?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return client.disconnect(true);
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(process.env.JWT_ACCESS_SECRET),
        { algorithms: ['HS256'] },
      );
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string')
        throw new Error('Invalid claims');
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: 'ACTIVE' },
        },
        select: { id: true },
      });
      if (!session) throw new Error('Inactive session');
      const employee = await this.prisma.employee.findUnique({
        where: { userId: payload.sub },
        select: { id: true },
      });
      client.data.auth = { userId: payload.sub, employeeId: employee?.id };
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('thread:join')
  async join(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { threadId?: string },
  ) {
    const auth = client.data.auth;
    if (!auth || typeof data.threadId !== 'string')
      throw new WsException('Authentication and threadId are required');
    try {
      if (auth.employeeId)
        await this.support.assertStaffPermission(auth.userId);
      else await this.support.assertCustomerThread(auth.userId, data.threadId);
    } catch {
      throw new WsException('Thread access denied');
    }
    await client.join(`thread:${data.threadId}`);
    return { joined: data.threadId };
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: SendSupportMessageDto & { threadId?: string },
  ) {
    const auth = client.data.auth;
    if (
      !auth ||
      typeof data.threadId !== 'string' ||
      typeof data.clientMessageId !== 'string' ||
      typeof data.body !== 'string'
    )
      throw new WsException('Invalid support message');
    const message = auth.employeeId
      ? await this.support.sendStaff(auth.employeeId, data.threadId, data)
      : await this.support.sendCustomer(auth.userId, data.threadId, data);
    this.publish(data.threadId, message);
    return message;
  }

  publish(threadId: string, message: unknown) {
    this.server?.to(`thread:${threadId}`).emit('message:created', message);
  }
}

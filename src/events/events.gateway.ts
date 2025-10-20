import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { EventsService } from './events.service';
import { PaymentMethod } from '@prisma/client';
import { randomUUID } from 'crypto';

interface WebSocketClient extends Socket {
  connectionType?: 'payee' | 'customer';
  payeeId?: number;
  userId?: number;
  connectionId?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly eventsService: EventsService) {}

  private buildSubmitOrderPayload(data: unknown) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid order payload');
    }
    const id = randomUUID();
    const d = data as Record<string, unknown>;
    const customer_id = Number(d.customer_id);
    const loan_id = d.loan_id as string;
    const amount = d.amount as string | number;
    const payment_periods = Number(d.payment_periods);
    const payment_method_input = d.payment_method;
    const remark = d.remark as string | null | undefined;
    const customer = (d.customer as { address?: string } | undefined) ?? {};

    if (!Number.isFinite(customer_id)) {
      throw new Error('Invalid customer_id');
    }
    if (!loan_id) {
      throw new Error('Invalid loan_id');
    }
    if (amount === null || amount === undefined) {
      throw new Error('Invalid amount');
    }
    if (!Number.isFinite(payment_periods)) {
      throw new Error('Invalid payment_periods');
    }
    const pm = String(payment_method_input);
    if (pm !== 'wechat_pay' && pm !== 'ali_pay') {
      throw new Error('Invalid payment_method');
    }

    return {
      id,
      customer_id,
      loan_id,
      amount,
      payment_periods,
      payment_method: pm as PaymentMethod,
      remark: remark ?? null,
      customer,
    };
  }

  async handleConnection(client: WebSocketClient, ...args: any[]) {
    console.log('🔌 WebSocket客户端连接:', {
      clientId: client.id,
      query: client.handshake.query,
      headers: client.handshake.headers,
      address: client.handshake.address,
    });

    // 从查询参数获取连接信息
    const query = client.handshake.query;
    const type = query.type as 'payee' | 'customer';
    const userIdQuery = query.user_id as string;
    const adminIdQuery = query.admin_id as string;

    console.log('📋 连接参数解析:', {
      type,
      userIdQuery,
      adminIdQuery,
      isValidType: type === 'payee' || type === 'customer',
    });

    if (!type || (type !== 'payee' && type !== 'customer')) {
      console.error('❌ 无效的连接类型:', type);
      client.disconnect();
      return;
    }

    let payeeId: number | undefined;
    if (type === 'payee') {
      const adminId = adminIdQuery ? Number(adminIdQuery) : undefined;
      console.log('🔍 收款人连接 - 管理员ID:', adminId);

      if (!adminId || !Number.isFinite(adminId)) {
        console.error('❌ 收款人连接缺少或无效的admin_id:', adminIdQuery);
        client.disconnect();
        return;
      }

      console.log('�� 查找管理员绑定的收款人...');
      const foundPayeeId = await this.eventsService.findPayeeIdByAdmin(adminId);
      console.log('�� 查找结果:', { adminId, foundPayeeId });

      if (!foundPayeeId) {
        console.error('❌ 该管理员未绑定收款人:', adminId);
        client.disconnect();
        return;
      }
      payeeId = foundPayeeId;
      console.log('✅ 找到收款人ID:', payeeId);
    }

    if (type === 'customer' && !userIdQuery) {
      console.error('❌ 客户连接缺少user_id');
      client.disconnect();
      return;
    }

    const userId = userIdQuery ? Number(userIdQuery) : undefined;
    console.log('�� 添加连接到服务:', { type, payeeId, userId });

    const connectionId = this.eventsService.addConnection(type, client, {
      payeeId,
      userId,
    });

    // 保存连接信息到客户端对象
    client.connectionType = type;
    client.payeeId = payeeId;
    client.userId = userId;
    client.connectionId = connectionId;

    // 发送连接成功消息
    client.emit('connected', {
      type: 'connected',
      connectionId,
      data: { payeeId, userId },
    });

    console.log(`✅ WebSocket客户端 ${client.id} 连接成功`, {
      type,
      payeeId,
      userId,
      connectionId,
    });
  }

  handleDisconnect(client: WebSocketClient) {
    console.log('WebSocket client disconnected:', client.id);

    if (client.connectionId && client.connectionType) {
      this.eventsService.removeConnection(
        client.connectionId,
        client.connectionType,
        {
          payeeId: client.payeeId,
          userId: client.userId,
        },
      );
    }
  }

  @SubscribeMessage('submit_order')
  async handleSubmitOrder(
    @ConnectedSocket() client: WebSocketClient,
    @MessageBody() data: unknown,
  ) {
    try {
      const payload = this.buildSubmitOrderPayload(data);
      const result = await this.eventsService.submitOrder(payload);

      // 发送确认消息给客户
      client.emit('order_submitted', {
        type: 'order_submitted',
        data: result,
      });

      return result;
    } catch (error) {
      client.emit('error', {
        type: 'error',
        data: { message: error.message || '提交订单失败' },
      });
      throw error;
    }
  }

  @SubscribeMessage('grab_order')
  async handleGrabOrder(
    @ConnectedSocket() client: WebSocketClient,
    @MessageBody() data: { id: string; admin_id: number },
  ) {
    try {
      const adminId = data?.admin_id ? Number(data.admin_id) : undefined;
      if (!adminId || !Number.isFinite(adminId)) {
        throw new Error('Missing or invalid admin_id in request body');
      }

      const foundPayeeId = await this.eventsService.findPayeeIdByAdmin(adminId);
      if (!foundPayeeId) {
        throw new Error('该管理员未绑定收款人');
      }

      const orderId = String(data?.id);
      if (!orderId || typeof orderId !== 'string') {
        throw new Error('Invalid order id');
      }

      // 获取订单信息
      const order = await this.eventsService.getOrderById(orderId);
      if (!order) {
        throw new Error('订单不存在');
      }

      const result = await this.eventsService.handleGrabOrder(
        foundPayeeId,
        orderId,
      );

      // 如果抢单成功，通知客户
      if (result.success && client.userId) {
        const customerConnectionId = this.eventsService.getCustomerConnectionId(
          client.userId,
        );
        if (customerConnectionId) {
          const customerSocket =
            this.server.sockets.sockets.get(customerConnectionId);
          if (customerSocket) {
            customerSocket.emit('order_grabbed', {
              type: 'order_grabbed',
              data: {
                id: orderId,
                payeeId: foundPayeeId,
                payeeName: result.payeeName,
              },
            });
          }
        }
      }

      return result;
    } catch (error) {
      client.emit('error', {
        type: 'error',
        data: { message: error.message || '抢单失败' },
      });
      throw error;
    }
  }
}

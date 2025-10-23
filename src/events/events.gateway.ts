/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
  namespace: '/events',
  transports: ['websocket', 'polling'],
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
    // console.log('🔌 WebSocket客户端连接:', {
    //   clientId: client.id,
    //   query: client.handshake.query,
    //   headers: client.handshake.headers,
    //   address: client.handshake.address,
    //   url: client.handshake.url,
    //   namespace: client.nsp.name,
    // });

    // 从查询参数获取连接信息
    const query = client.handshake.query;
    const type = query.type as 'payee' | 'customer';
    const userIdQuery = query.user_id as string;
    const adminIdQuery = query.admin_id as string;

    if (!type || (type !== 'payee' && type !== 'customer')) {
      console.error('❌ 无效的连接类型:', {
        type,
        validTypes: ['payee', 'customer'],
        allQueryParams: query,
      });
      client.emit('error', {
        type: 'connection_error',
        data: {
          message: `Invalid connection type: ${type}. Must be 'payee' or 'customer'`,
        },
      });
      client.disconnect();
      return;
    }

    let payeeId: number | undefined;
    if (type === 'payee') {
      const adminId = adminIdQuery ? Number(adminIdQuery) : undefined;

      if (!adminId || !Number.isFinite(adminId)) {
        console.error('❌ 收款人连接缺少或无效的admin_id:', {
          adminIdQuery,
          parsedAdminId: adminId,
          isFinite: Number.isFinite(adminId),
        });
        client.emit('error', {
          type: 'connection_error',
          data: { message: `Missing or invalid admin_id: ${adminIdQuery}` },
        });
        client.disconnect();
        return;
      }

      const foundPayeeId = await this.eventsService.findPayeeIdByAdmin(adminId);

      if (!foundPayeeId) {
        console.error('❌ 该管理员未绑定收款人:', {
          adminId,
          foundPayeeId,
        });
        client.emit('error', {
          type: 'connection_error',
          data: { message: `Admin ${adminId} is not bound to any payee` },
        });
        client.disconnect();
        return;
      }
      payeeId = foundPayeeId;
    }

    if (type === 'customer' && !userIdQuery) {
      console.error('❌ 客户连接缺少user_id:', {
        type,
        userIdQuery,
        allQueryParams: query,
      });
      client.emit('error', {
        type: 'connection_error',
        data: { message: 'Customer connection missing user_id' },
      });
      client.disconnect();
      return;
    }

    const userId = userIdQuery ? Number(userIdQuery) : undefined;

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
      console.log('📥 提交订单请求数据:', data);
      const payload = this.buildSubmitOrderPayload(data);
      const result = await this.eventsService.submitOrder(payload);

      // 发送确认消息给客户
      client.emit('order_submitted', {
        type: 'order_submitted',
        data: result,
      });

      return result;
    } catch (error: any) {
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
      console.log('🎯 抢单请求数据:', data);
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
      if (result.success && order.customer_id) {
        const customerConnectionId = this.eventsService.getCustomerConnectionId(
          order.customer_id,
        );
        console.log('📨 尝试通知客户:', {
          customerId: order.customer_id,
          connectionId: customerConnectionId,
        });
        let customerSocket: Socket | undefined;

        if (customerConnectionId) {
          try {
            const serverSockets = (this.server as any).sockets;
            console.log('🔍 server.sockets snapshot:', {
              type: typeof serverSockets,
              hasSocketsField: !!serverSockets?.sockets,
              socketsIsMap: serverSockets?.sockets instanceof Map,
            });
            // 常见结构 1: this.server.sockets 是 namespace，内部有 .sockets (Map or object)
            if (serverSockets) {
              if (typeof serverSockets.get === 'function') {
                // 直接是 Map-like
                customerSocket = serverSockets.get(customerConnectionId);
              } else if (serverSockets.sockets) {
                const inner = serverSockets.sockets;
                if (inner instanceof Map) {
                  customerSocket = inner.get(customerConnectionId);
                } else {
                  // plain object keyed by socket id
                  customerSocket = inner[customerConnectionId];
                }
              }
            }
          } catch (e) {
            console.error('🔴 获取 customer socket 时发生异常:', e);
          }

          if (customerSocket) {
            customerSocket.emit('order_grabbed', {
              type: 'order_grabbed',
              data: {
                id: orderId,
                payeeId: foundPayeeId,
                payeeName: result.payeeName,
              },
            });
            console.log('✅ 已发送抢单通知给客户:', order.customer_id);
          } else {
            console.log(
              '❌ 未找到客户的socket连接（兼容检索失败）:',
              customerConnectionId,
            );
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

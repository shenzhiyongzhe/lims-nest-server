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
import { ChatService } from '../chat/chat.service';
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

  constructor(
    private readonly eventsService: EventsService,
    private readonly chatService: ChatService,
  ) {}

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
    console.log('WebSocket client connected:', client.id);

    // 从查询参数获取连接信息
    const query = client.handshake.query;
    const type = query.type as 'payee' | 'customer';
    const userIdQuery = query.user_id as string;
    const adminIdQuery = query.admin_id as string;

    if (!type || (type !== 'payee' && type !== 'customer')) {
      console.error('Invalid connection type:', type);
      client.disconnect();
      return;
    }

    let payeeId: number | undefined;
    if (type === 'payee') {
      const adminId = adminIdQuery ? Number(adminIdQuery) : undefined;
      if (!adminId || !Number.isFinite(adminId)) {
        console.error('Missing or invalid admin_id for payee connection');
        client.disconnect();
        return;
      }

      const foundPayeeId = await this.eventsService.findPayeeIdByAdmin(adminId);
      if (!foundPayeeId) {
        console.error('该管理员未绑定收款人');
        client.disconnect();
        return;
      }
      payeeId = foundPayeeId;
    }

    if (type === 'customer' && !userIdQuery) {
      console.error('Missing user_id for customer connection');
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

    console.log(`WebSocket client ${client.id} connected as ${type}`, {
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

      // 获取订单信息以便获取loan_id
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

            // 发送聊天通知给客户
            try {
              const chatMessage = `您的订单已被 ${result.payeeName} 接单，请及时完成支付。`;
              await this.sendChatNotificationWithLoanId(
                client.userId,
                adminId, // 使用管理员ID而不是收款人ID
                order.loan_id,
                chatMessage,
                'text',
              );
            } catch (chatError) {
              console.error('Failed to send chat notification:', chatError);
            }
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

  /**
   * 发送聊天通知（带loan_id版本）
   */
  private async sendChatNotificationWithLoanId(
    userId: number,
    adminId: number,
    loanId: string,
    message: string,
    messageType: 'text' | 'image' = 'text',
  ) {
    try {
      // 查找或创建聊天会话
      const chatSession = await this.chatService.getOrCreateChatSession({
        loan_id: loanId,
        admin_id: adminId,
        user_id: userId,
      });

      // 发送聊天消息
      const chatMessage = await this.chatService.sendMessage({
        session_id: chatSession.id,
        sender_id: adminId,
        sender_type: 'admin',
        message_type: messageType,
        content: message,
      });

      // 广播聊天消息给聊天室内的所有客户端
      this.server.to(`chat_${chatSession.id}`).emit('new_message', {
        message: {
          id: chatMessage.id,
          session_id: chatMessage.session_id,
          sender_id: chatMessage.sender_id,
          sender_type: chatMessage.sender_type,
          message_type: chatMessage.message_type,
          content: chatMessage.content,
          is_read: chatMessage.is_read,
          created_at: chatMessage.created_at,
        },
      });

      console.log(`Chat notification sent in room: chat_${chatSession.id}`);
    } catch (error) {
      console.error('Failed to send chat notification:', error);
    }
  }

  /**
   * 发送聊天通知（通用版本）
   */
  private async sendChatNotification(
    userId: number,
    adminId: number,
    message: string,
    messageType: 'text' | 'image' = 'text',
  ) {
    // 默认使用一个通用loan_id，需要在调用时提供正确的loan_id
    await this.sendChatNotificationWithLoanId(
      userId,
      adminId,
      'default',
      message,
      messageType,
    );
  }

  /**
   * 处理聊天消息
   */
  @SubscribeMessage('chat_message')
  async handleChatMessage(
    @ConnectedSocket() client: WebSocketClient,
    @MessageBody()
    data: {
      loan_id?: string;
      target_user_id?: number;
      target_admin_id?: number;
      message_type: 'text' | 'image';
      content: string;
    },
  ) {
    try {
      if (!data.content?.trim()) {
        throw new Error('消息内容不能为空');
      }

      let chatSession;
      let targetAdminId = data.target_admin_id;
      let targetUserId = data.target_user_id;

      // 根据连接类型确定目标用户
      if (client.connectionType === 'payee' && client.payeeId) {
        // 收款人发送消息给客户
        targetUserId = data.target_user_id;
        targetAdminId = client.payeeId; // 实际上应该是对应的管理员ID
      } else if (client.connectionType === 'customer' && client.userId) {
        // 客户发送消息给收款人
        targetAdminId = data.target_admin_id;
        targetUserId = client.userId;
      }

      // 如果指定了loan_id，创建或获取聊天会话
      if (data.loan_id) {
        chatSession = await this.chatService.getOrCreateChatSession({
          loan_id: data.loan_id,
          admin_id: targetAdminId || 0,
          user_id: targetUserId || 0,
        });
      } else {
        throw new Error('必须指定loan_id来创建聊天会话');
      }

      // 发送聊天消息
      const message = await this.chatService.sendMessage({
        session_id: chatSession.id,
        sender_id: client.userId!,
        sender_type: client.connectionType === 'payee' ? 'admin' : 'user',
        message_type: data.message_type,
        content: data.content,
      });

      // 广播消息给聊天室内的所有客户端
      this.server.to(`chat_${chatSession.id}`).emit('new_message', {
        message: {
          id: message.id,
          session_id: message.session_id,
          sender_id: message.sender_id,
          sender_type: message.sender_type,
          message_type: message.message_type,
          content: message.content,
          is_read: message.is_read,
          created_at: message.created_at,
        },
      });

      return { success: true, message_id: message.id };
    } catch (error) {
      client.emit('error', {
        type: 'chat_error',
        data: { message: error.message || '发送聊天消息失败' },
      });
      throw error;
    }
  }

  /**
   * 加入聊天室
   */
  @SubscribeMessage('join_chat_room')
  async handleJoinChatRoom(
    @ConnectedSocket() client: WebSocketClient,
    @MessageBody() data: { session_id: string },
  ) {
    try {
      const sessionId = data.session_id;

      // 验证聊天会话是否存在且用户有权限访问
      const session = await this.chatService.getChatSessionWithMessages(
        sessionId,
        client.userId!,
        client.connectionType === 'payee' ? 'admin' : 'user',
      );

      // 加入聊天室
      await client.join(`chat_${sessionId}`);

      // 发送会话信息和历史消息
      client.emit('chat_room_joined', {
        session: session,
      });

      console.log(`Client ${client.id} joined chat room: chat_${sessionId}`);
    } catch (error) {
      client.emit('error', {
        type: 'join_chat_room_error',
        data: { message: error.message || '加入聊天室失败' },
      });
      throw error;
    }
  }

  /**
   * 获取聊天会话列表
   */
  @SubscribeMessage('get_chat_sessions')
  async handleGetChatSessions(@ConnectedSocket() client: WebSocketClient) {
    try {
      const userType = client.connectionType === 'payee' ? 'admin' : 'user';
      const sessions = await this.chatService.getUserChatSessions(
        client.userId!,
        userType,
      );

      client.emit('chat_sessions', {
        sessions,
      });
    } catch (error) {
      client.emit('error', {
        type: 'get_chat_sessions_error',
        data: { message: error.message || '获取聊天会话失败' },
      });
    }
  }
}

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
import { ChatService } from './chat.service';
import { MessageType } from '@prisma/client';

interface ChatSocketClient extends Socket {
  userId?: number;
  userType?: 'admin' | 'user';
  loanId?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  async handleConnection(client: ChatSocketClient, ...args: any[]) {
    console.log('Chat WebSocket client connected:', client.id);

    // 从查询参数获取用户信息
    const query = client.handshake.query;
    const userId = query.user_id ? Number(query.user_id) : undefined;
    const userType = query.user_type as 'admin' | 'user';
    const loanId = query.loan_id as string;

    if (!userId || !userType || !loanId) {
      console.error('Missing required connection parameters:', {
        userId,
        userType,
        loanId,
      });
      client.disconnect();
      return;
    }

    // 保存用户信息到客户端对象
    client.userId = userId;
    client.userType = userType;
    client.loanId = loanId;

    console.log(
      `Chat client ${client.id} connected as ${userType} with loan ${loanId}`,
    );
  }

  handleDisconnect(client: ChatSocketClient) {
    console.log('Chat WebSocket client disconnected:', client.id);
  }

  /**
   * 加入聊天室
   */
  @SubscribeMessage('join_chat')
  async handleJoinChat(
    @ConnectedSocket() client: ChatSocketClient,
    @MessageBody()
    data: { loan_id: string; admin_id?: number; user_id?: number },
  ) {
    try {
      // 创建或获取聊天会话
      const session = await this.chatService.getOrCreateChatSession({
        loan_id: data.loan_id,
        admin_id: data.admin_id!,
        user_id: data.user_id!,
      });

      // 加入聊天室
      await client.join(`chat_${session.id}`);

      // 发送会话信息和历史消息
      const sessionWithMessages =
        await this.chatService.getChatSessionWithMessages(
          session.id,
          client.userId!,
          client.userType!,
        );

      // 发送给客户端
      client.emit('chat_session_joined', {
        session: sessionWithMessages,
      });

      console.log(`Client ${client.id} joined chat room: chat_${session.id}`);
    } catch (error) {
      client.emit('error', {
        type: 'join_chat_error',
        message: error.message || '加入聊天室失败',
      });
    }
  }

  /**
   * 发送聊天消息
   */
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: ChatSocketClient,
    @MessageBody()
    data: {
      session_id: string;
      message_type: MessageType;
      content: string;
    },
  ) {
    try {
      // 发送消息
      const message = await this.chatService.sendMessage({
        session_id: data.session_id,
        sender_id: client.userId!,
        sender_type: client.userType!,
        message_type: data.message_type,
        content: data.content,
      });

      // 广播消息给聊天室内的所有客户端
      this.server.to(`chat_${data.session_id}`).emit('new_message', {
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

      console.log(`Message sent in chat room: chat_${data.session_id}`);
    } catch (error) {
      client.emit('error', {
        type: 'send_message_error',
        message: error.message || '发送消息失败',
      });
    }
  }

  /**
   * 标记消息为已读
   */
  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: ChatSocketClient,
    @MessageBody() data: { session_id: string },
  ) {
    try {
      await this.chatService.markMessagesAsRead(
        data.session_id,
        client.userId!,
        client.userType!,
      );

      // 广播已读状态给聊天室内的其他客户端
      client.to(`chat_${data.session_id}`).emit('messages_read', {
        session_id: data.session_id,
        user_id: client.userId,
        user_type: client.userType,
      });
    } catch (error) {
      client.emit('error', {
        type: 'mark_read_error',
        message: error.message || '标记已读失败',
      });
    }
  }

  /**
   * 获取未读消息总数
   */
  @SubscribeMessage('get_unread_count')
  async handleGetUnreadCount(@ConnectedSocket() client: ChatSocketClient) {
    try {
      const unreadCount = await this.chatService.getUnreadMessageCount(
        client.userId!,
        client.userType!,
      );

      client.emit('unread_count', {
        unread_count: unreadCount,
      });
    } catch (error) {
      client.emit('error', {
        type: 'get_unread_count_error',
        message: error.message || '获取未读消息数失败',
      });
    }
  }
}

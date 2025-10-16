import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoanAccountStatus, MessageType } from '@prisma/client';

export interface CreateChatSessionDto {
  admin_id: number;
  user_id: number;
  admin_client_id?: string;
  user_client_id?: string;
}
import { Decimal } from '@prisma/client/runtime/library';
export interface SendMessageDto {
  session_id: string;
  sender_id: number;
  sender_type: 'admin' | 'user';
  message_type: MessageType;
  content: string;
}

export interface ChatSessionWithMessages {
  id: string;
  admin_id: number;
  user_id: number;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date;
  admin?: {
    id: number;
    username: string;
  };
  user?: {
    id: number;
    username: string;
    phone: string;
  };
  messages?: Array<{
    id: string;
    sender_id: number;
    sender_type: string;
    message_type: MessageType;
    content: string;
    is_read: boolean;
    created_at: Date;
  }>;
  unread_count?: number;
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建或获取聊天会话
   */
  async getOrCreateChatSession(
    dto: CreateChatSessionDto,
  ): Promise<ChatSessionWithMessages> {
    // 先尝试查找现有的聊天会话
    let session = await this.prisma.chatSession.findUnique({
      where: {
        admin_client_id_user_client_id: {
          admin_client_id: dto.admin_client_id || '',
          user_client_id: dto.user_client_id || '',
        },
      },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            phone: true,
          },
        },
      },
    });

    if (!session) {
      // 如果不存在，创建新的聊天会话
      session = await this.prisma.chatSession.create({
        data: {
          admin_id: dto.admin_id,
          user_id: dto.user_id,
          admin_client_id: dto.admin_client_id,
          user_client_id: dto.user_client_id,
        },
        include: {
          admin: {
            select: {
              id: true,
              username: true,
            },
          },
          user: {
            select: {
              id: true,
              username: true,
              phone: true,
            },
          },
        },
      });
    }

    return session as unknown as ChatSessionWithMessages;
  }

  /**
   * 发送聊天消息
   */
  async sendMessage(dto: SendMessageDto) {
    // 验证聊天会话是否存在
    const session = await this.prisma.chatSession.findUnique({
      where: { id: dto.session_id },
    });

    if (!session) {
      throw new BadRequestException('聊天会话不存在');
    }

    // 创建消息
    const message = await this.prisma.chatMessage.create({
      data: {
        session_id: dto.session_id,
        sender_id: dto.sender_id,
        sender_type: dto.sender_type,
        message_type: dto.message_type,
        content: dto.content,
      },
    });

    // 更新聊天会话的最后消息时间
    await this.prisma.chatSession.update({
      where: { id: dto.session_id },
      data: {
        last_message_at: new Date(),
      },
    });

    return message;
  }

  /**
   * 获取聊天会话的历史消息
   */
  async getChatMessages(
    sessionId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const messages = await this.prisma.chatMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip,
    });

    // 按时间倒序排列（最新的在前）
    return messages.reverse();
  }

  /**
   * 获取用户的聊天会话列表（包含未读消息数）
   */
  async getUserChatSessions(
    userId: number,
    userType: 'admin' | 'user',
    clientId?: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const sessions = await this.prisma.chatSession.findMany({
      where: {
        [userType === 'admin' ? 'admin_id' : 'user_id']: userId,
        ...(clientId && {
          [userType === 'admin' ? 'admin_client_id' : 'user_client_id']:
            clientId,
        }),
      },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            phone: true,
          },
        },
      },
      orderBy: { last_message_at: 'desc' },
      take: limit,
      skip,
    });

    // 计算未读消息数并添加最后一条消息
    const sessionsWithUnreadCount = await Promise.all(
      sessions.map(async (session) => {
        // 获取未读消息数
        const unreadCount = await this.prisma.chatMessage.count({
          where: {
            session_id: session.id,
            is_read: false,
            sender_type: userType === 'admin' ? 'user' : 'admin',
          },
        });

        // 获取最后一条消息
        const lastMessage = await this.prisma.chatMessage.findFirst({
          where: { session_id: session.id },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            content: true,
            message_type: true,
            created_at: true,
            sender_type: true,
          },
        });

        return {
          ...session,
          unread_count: unreadCount,
          last_message: lastMessage,
        };
      }),
    );

    return sessionsWithUnreadCount;
  }

  /**
   * 标记消息为已读
   */
  async markMessagesAsRead(
    sessionId: string,
    userId: number,
    userType: 'admin' | 'user',
  ) {
    await this.prisma.chatMessage.updateMany({
      where: {
        session_id: sessionId,
        is_read: false,
        sender_type: userType === 'admin' ? 'user' : 'admin',
      },
      data: {
        is_read: true,
      },
    });

    return { success: true };
  }

  /**
   * 获取聊天会话详情（包含完整信息）
   */
  async getChatSessionWithMessages(
    sessionId: string,
    currentUserId: number,
    currentUserType: 'admin' | 'user',
  ): Promise<ChatSessionWithMessages> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            phone: true,
          },
        },
      },
    });

    if (!session) {
      throw new BadRequestException('聊天会话不存在');
    }

    // 获取最近50条消息
    const messages = await this.prisma.chatMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'asc' },
      take: 50,
    });

    // 标记消息为已读
    await this.markMessagesAsRead(sessionId, currentUserId, currentUserType);

    return {
      ...session,
      messages,
    } as unknown as ChatSessionWithMessages;
  }

  /**
   * 获取未读消息总数
   */
  async getUnreadMessageCount(
    userId: number,
    userType: 'admin' | 'user',
  ): Promise<number> {
    const count = await this.prisma.chatMessage.count({
      where: {
        is_read: false,
        sender_type: userType === 'admin' ? 'user' : 'admin',
        session: {
          [userType === 'admin' ? 'admin_id' : 'user_id']: userId,
        },
      },
    });

    return count;
  }
}

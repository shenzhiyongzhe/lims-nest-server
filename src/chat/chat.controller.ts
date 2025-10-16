import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { MessageType } from '@prisma/client';

interface AuthenticatedRequest {
  clientId?: string;
  cookies?: { [key: string]: string };
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * 从cookie中获取用户信息
   */
  private getUserFromCookie(cookies: { [key: string]: string }) {
    // 从cookie中获取管理员信息
    const adminData = cookies.admin;
    if (adminData) {
      try {
        const admin = JSON.parse(decodeURIComponent(adminData));
        return {
          id: admin.id,
          role: '管理员',
          isAdmin: true,
        };
      } catch (e) {
        console.error('Failed to parse admin cookie:', e);
      }
    }

    return null;
  }

  /**
   * 获取用户的聊天会话列表
   */
  @Get('sessions')
  async getChatSessions(
    @Req() request: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const user = this.getUserFromCookie(request.cookies || {});
    if (!user) {
      throw new BadRequestException('未找到用户身份信息');
    }

    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const userType = user.role === '管理员' ? 'admin' : 'user';

    // 获取或生成客户端ID
    const clientId = request.clientId || this.generateClientId(user.id);

    return this.chatService.getUserChatSessions(
      user.id,
      userType,
      clientId,
      pageNum,
      limitNum,
    );
  }

  /**
   * 获取聊天会话详情和消息历史
   */
  @Get('sessions/:sessionId')
  async getChatSessionWithMessages(
    @Param('sessionId') sessionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = this.getUserFromCookie(request.cookies || {});
    if (!user) {
      throw new BadRequestException('未找到用户身份信息');
    }

    const userType = user.role === 'admin' ? 'admin' : 'user';
    return this.chatService.getChatSessionWithMessages(
      sessionId,
      user.id,
      userType,
    );
  }

  /**
   * 获取更多历史消息
   */
  @Get('sessions/:sessionId/messages')
  async getMoreMessages(
    @Param('sessionId') sessionId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;

    return this.chatService.getChatMessages(sessionId, pageNum, limitNum);
  }

  /**
   * 发送聊天消息
   */
  @Post('messages')
  async sendMessage(
    @Body()
    dto: {
      session_id: string;
      message_type: MessageType;
      content: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    const user = this.getUserFromCookie(request.cookies || {});
    if (!user) {
      throw new BadRequestException('未找到用户身份信息');
    }

    // 验证发送者身份
    const userType = user.role === 'admin' ? 'admin' : 'user';
    return this.chatService.sendMessage({
      session_id: dto.session_id,
      sender_id: user.id,
      sender_type: userType as 'admin' | 'user',
      message_type: dto.message_type,
      content: dto.content,
    });
  }

  /**
   * 创建或获取聊天会话
   */
  @Post('sessions')
  async getOrCreateChatSession(
    @Body() dto: { admin_id?: number; user_id?: number },
    @Req() request: AuthenticatedRequest,
  ) {
    const user = this.getUserFromCookie(request.cookies || {});
    if (!user) {
      throw new BadRequestException('未找到用户身份信息');
    }

    const userType = user.role === 'admin' ? 'admin' : 'user';

    if (userType === 'admin' && !dto.admin_id) {
      dto.admin_id = user.id;
    } else if (userType === 'user' && !dto.user_id) {
      dto.user_id = user.id;
    }

    // 获取当前用户的客户端ID
    const currentClientId = request.clientId || this.generateClientId(user.id);

    return this.chatService.getOrCreateChatSession({
      admin_id: dto.admin_id!,
      user_id: dto.user_id!,
      admin_client_id: userType === 'admin' ? currentClientId : undefined,
      user_client_id: userType === 'user' ? currentClientId : undefined,
    });
  }

  /**
   * 生成客户端ID（如果没有的话）
   */
  private generateClientId(userId?: number): string {
    if (userId) {
      // 管理员的客户端ID基于管理员ID固定
      return `admin_client_${userId}`;
    }
    // 普通用户的客户端ID随机生成
    return `user_client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取未读消息总数
   */
  @Get('unread-count')
  async getUnreadCount(@Req() request: AuthenticatedRequest) {
    const user = this.getUserFromCookie(request.cookies || {});
    if (!user) {
      throw new BadRequestException('未找到用户身份信息');
    }

    const userType = user.role === 'admin' ? 'admin' : 'user';
    return {
      unread_count: await this.chatService.getUnreadMessageCount(
        user.id,
        userType,
      ),
    };
  }

  /**
   * 标记会话消息为已读
   */
  @Post('sessions/:sessionId/mark-read')
  async markMessagesAsRead(
    @Param('sessionId') sessionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = this.getUserFromCookie(request.cookies || {});
    if (!user) {
      throw new BadRequestException('未找到用户身份信息');
    }

    const userType = user.role === 'admin' ? 'admin' : 'user';
    return this.chatService.markMessagesAsRead(sessionId, user.id, userType);
  }
}

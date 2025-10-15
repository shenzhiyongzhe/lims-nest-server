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
import { CurrentUser } from '../auth/current-user.decorator';
import { MessageType } from '@prisma/client';

interface AuthenticatedRequest {
  user: {
    id: number;
    role: string;
  };
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * 获取用户的聊天会话列表
   */
  @Get('sessions')
  async getChatSessions(
    @CurrentUser() user: { id: number; role: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const userType = user.role === 'admin' ? 'admin' : 'user';

    return this.chatService.getUserChatSessions(
      user.id,
      userType,
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
    @CurrentUser() user: { id: number; role: string },
  ) {
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
    @CurrentUser() user: { id: number; role: string },
  ) {
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
    @Body() dto: { loan_id: string; admin_id?: number; user_id?: number },
    @CurrentUser() user: { id: number; role: string },
  ) {
    const userType = user.role === 'admin' ? 'admin' : 'user';

    if (userType === 'admin' && !dto.admin_id) {
      dto.admin_id = user.id;
    } else if (userType === 'user' && !dto.user_id) {
      dto.user_id = user.id;
    }

    return this.chatService.getOrCreateChatSession({
      loan_id: dto.loan_id,
      admin_id: dto.admin_id!,
      user_id: dto.user_id!,
    });
  }

  /**
   * 获取未读消息总数
   */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: { id: number; role: string }) {
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
    @CurrentUser() user: { id: number; role: string },
  ) {
    const userType = user.role === 'admin' ? 'admin' : 'user';
    return this.chatService.markMessagesAsRead(sessionId, user.id, userType);
  }
}

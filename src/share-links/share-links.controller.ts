import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ShareLinksService } from './share-links.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('share-links')
export class ShareLinksController {
  constructor(private readonly shareLinksService: ShareLinksService) {}

  @UseGuards(AuthGuard, RolesGuard)
  @Post()
  async createShareLink(
    @Body() data: CreateShareLinkDto,
    @CurrentUser() user: { id: number },
  ): Promise<ApiResponseDto> {
    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const result = await this.shareLinksService.createShareLink(
        data,
        user.id,
        baseUrl,
      );
      return ResponseHelper.success(result, '创建分享链接成功');
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('创建分享链接失败');
    }
  }

  @Get(':shareId')
  async getShareLink(
    @Param('shareId') shareId: string,
  ): Promise<ApiResponseDto> {
    try {
      const shareLink = await this.shareLinksService.getShareLink(shareId);
      const data = {
        shareId: shareLink.share_id,
        summary: JSON.parse(shareLink.summary) as unknown,
        expiresAt: shareLink.expires_at,
      };
      return ResponseHelper.success(data, '获取分享链接成功');
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new BadRequestException('获取分享链接失败');
    }
  }
}

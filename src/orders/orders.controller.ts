import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { ResponseHelper } from '../common/response-helper';
import {
  ManagementRoles,
  OrderStatus,
  PaymentFeedback,
  ReviewStatus,
} from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { Roles } from 'src/auth/roles.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.ADMIN, ManagementRoles.PAYEE)
  async getOrders(
    @CurrentUser() user: { id: number },
    @Query('status') status?: OrderStatus,
    @Query('today') today: string = 'true',
    @Query('date') date?: string,
  ): Promise<ApiResponseDto> {
    const rows = await this.ordersService.getOrders(user.id, {
      status,
      today: today !== 'false',
      date,
    });
    return ResponseHelper.success(rows, '获取订单成功');
  }

  @Put('payment-feedback')
  async updatePaymentFeedback(
    @Body() body: { id: string; payment_feedback: PaymentFeedback },
  ): Promise<ApiResponseDto> {
    if (!body.id || !body.payment_feedback) {
      return ResponseHelper.error('缺少必要参数', 400);
    }
    const updated = await this.ordersService.updatePaymentFeedback(
      body.id,
      body.payment_feedback,
    );
    return ResponseHelper.success(updated, '更新支付反馈成功');
  }

  @Put('review-status')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.PAYEE)
  async updateReviewStatus(
    @CurrentUser() user: { id: number },
    @Body()
    body: { id: string; review_status: ReviewStatus; status?: OrderStatus },
  ): Promise<ApiResponseDto> {
    if (!body.id || !body.review_status) {
      return ResponseHelper.error('缺少必要参数', 400);
    }
    const updated = await this.ordersService.updateReviewStatus(
      user.id,
      body.id,
      body.review_status,
      body.status,
    );
    return ResponseHelper.success(updated, '更新审核状态成功');
  }

  @Get('review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.PAYEE)
  async getReviewOrders(
    @CurrentUser() user: { id: number },
    @Query('review_status') reviewStatus?: ReviewStatus,
    @Query('date') date?: string,
  ): Promise<ApiResponseDto> {
    const orders = await this.ordersService.getReviewOrders(
      user.id,
      reviewStatus,
      date,
    );
    return ResponseHelper.success(orders, '获取审核订单成功');
  }

  @Post('review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.PAYEE)
  async reviewOrder(
    @CurrentUser() user: { id: number },
    @Body() body: { order_id: string; actual_paid_amount: number },
  ): Promise<ApiResponseDto> {
    if (!body.order_id || !body.actual_paid_amount) {
      return ResponseHelper.error('缺少必要参数', 400);
    }

    if (body.actual_paid_amount <= 0) {
      return ResponseHelper.error('实付金额必须大于0', 400);
    }

    const updated = await this.ordersService.reviewOrder(
      user.id,
      body.order_id,
      body.actual_paid_amount,
    );
    return ResponseHelper.success(updated, '审核成功');
  }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.COLLECTOR)
  @Get('manual-processing')
  async getManualProcessingOrders(
    @CurrentUser() user: { id: number },
  ): Promise<ApiResponseDto> {
    const orders = await this.ordersService.getManualProcessingOrders(user.id);
    return ResponseHelper.success(orders, '获取手动处理订单成功');
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.COLLECTOR)
  @Post('manual-processing/:orderId/process')
  async processManualOrder(
    @CurrentUser() user: { id: number },
    @Param('orderId') orderId: string,
    @Body()
    body: {
      periodCount: number;
      totalCapital: number;
      totalInterest: number;
      fines: number;
    },
  ): Promise<ApiResponseDto> {
    if (
      !body.periodCount ||
      body.periodCount < 1 ||
      body.totalCapital === undefined ||
      body.totalInterest === undefined ||
      body.fines === undefined
    ) {
      return ResponseHelper.error('缺少必要参数或参数无效', 400);
    }

    const updated = await this.ordersService.processManualOrder(
      user.id,
      orderId,
      body,
    );
    return ResponseHelper.success(updated, '处理订单成功');
  }

  @Delete(':id')
  @UseGuards(AuthGuard, RolesGuard)
  async deleteOrder(
    @CurrentUser() user: { id: number },
    @Param('id') id: string,
  ): Promise<ApiResponseDto> {
    await this.ordersService.deleteOrder(user.id, id);
    return ResponseHelper.success(null, '删除订单成功');
  }
}

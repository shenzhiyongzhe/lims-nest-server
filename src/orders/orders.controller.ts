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
import { ManagementRoles, OrderStatus } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { Roles } from 'src/auth/roles.decorator';

@Controller('orders')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ManagementRoles.管理员, ManagementRoles.收款人)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
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

  @Post()
  async create(
    @CurrentUser() user: { id: number },
    @Body()
    body: CreateOrderDto,
  ): Promise<ApiResponseDto> {
    const created = await this.ordersService.createOrder(user.id, body);
    return ResponseHelper.success(created, '创建订单成功');
  }

  @Put()
  async update(
    @CurrentUser() user: { id: number },
    @Body() body: { id: string; status: OrderStatus },
  ): Promise<ApiResponseDto> {
    const updated = await this.ordersService.updateStatus(
      user.id,
      body.id,
      body.status,
    );
    return ResponseHelper.success(updated, '更新订单成功');
  }

  @Post('partial-payment')
  async partialPayment(
    @CurrentUser() user: { id: number },
    @Body() body: { id: string; paid_amount: number },
  ): Promise<ApiResponseDto> {
    if (!body.id || !body.paid_amount) {
      return ResponseHelper.error('缺少必要参数', 400);
    }

    if (body.paid_amount <= 0) {
      return ResponseHelper.error('支付金额必须大于0', 400);
    }

    const updated = await this.ordersService.partialPayment(
      user.id,
      body.id,
      body.paid_amount,
    );
    return ResponseHelper.success(updated, '部分还清成功');
  }

  @Get('review')
  async getReviewOrders(
    @CurrentUser() user: { id: number },
    @Query('status') status?: OrderStatus,
    @Query('date') date?: string,
  ): Promise<ApiResponseDto> {
    const orders = await this.ordersService.getReviewOrders(
      user.id,
      status,
      date,
    );
    return ResponseHelper.success(orders, '获取审核订单成功');
  }

  @Post('review')
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
  @Roles(ManagementRoles.负责人)
  @Get('manual-processing')
  async getManualProcessingOrders(
    @CurrentUser() user: { id: number },
  ): Promise<ApiResponseDto> {
    const orders = await this.ordersService.getManualProcessingOrders(user.id);
    return ResponseHelper.success(orders, '获取手动处理订单成功');
  }

  @Roles(ManagementRoles.负责人)
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
  async deleteOrder(
    @CurrentUser() user: { id: number },
    @Param('id') id: string,
  ): Promise<ApiResponseDto> {
    await this.ordersService.deleteOrder(user.id, id);
    return ResponseHelper.success(null, '删除订单成功');
  }
}

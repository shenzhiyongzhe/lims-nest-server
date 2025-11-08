import {
  Controller,
  Get,
  Post,
  Put,
  Query,
  Body,
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
  ): Promise<ApiResponseDto> {
    const rows = await this.ordersService.getOrders(user.id, {
      status,
      today: today !== 'false',
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
}

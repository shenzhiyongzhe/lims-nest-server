import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { EventsService } from './events.service';
import { PaymentMethod } from '@prisma/client';
import { randomUUID } from 'crypto';
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  private buildSubmitOrderPayload(data: unknown) {
    if (!data || typeof data !== 'object') {
      throw new BadRequestException('Invalid order payload');
    }
    const id = randomUUID();
    const d = data as Record<string, unknown>;
    const customer_id = Number(d.customer_id);
    const loan_id = d.loan_id as string;
    const amount = d.amount as string | number; // 保持原始类型，可能是string或number
    const payment_periods = Number(d.payment_periods);
    const payment_method_input = d.payment_method;
    const remark = d.remark as string | null | undefined;
    const customer = (d.customer as { address?: string } | undefined) ?? {};

    if (!Number.isFinite(customer_id)) {
      throw new BadRequestException('Invalid customer_id');
    }
    if (!loan_id) {
      throw new BadRequestException('Invalid loan_id');
    }
    if (amount === null || amount === undefined) {
      throw new BadRequestException('Invalid amount');
    }
    if (!Number.isFinite(payment_periods)) {
      throw new BadRequestException('Invalid payment_periods');
    }
    const pm = String(payment_method_input);
    if (pm !== 'wechat_pay' && pm !== 'ali_pay') {
      throw new BadRequestException('Invalid payment_method');
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

  @Post()
  async post(@Body() body: unknown) {
    const parsedBody = body as { type?: string; data?: unknown } | undefined;
    const type = parsedBody?.type;
    const data = parsedBody?.data;

    if (type === 'submit_order') {
      if (!data || typeof data !== 'object' || data === null) {
        throw new BadRequestException('Invalid order payload');
      }
      const payload = this.buildSubmitOrderPayload(data);
      return this.eventsService.submitOrder(payload);
    }

    if (type === 'grab_order') {
      const dataObj = data as { id: string; admin_id: number };
      const adminId = dataObj?.admin_id ? Number(dataObj.admin_id) : undefined;
      if (!adminId || !Number.isFinite(adminId)) {
        throw new BadRequestException(
          'Missing or invalid admin_id in request body',
        );
      }

      const foundPayeeId = await this.eventsService.findPayeeIdByAdmin(adminId);
      if (!foundPayeeId) {
        throw new BadRequestException('该管理员未绑定收款人');
      }

      const orderId = String(dataObj?.id);
      if (!orderId || typeof orderId !== 'string') {
        throw new BadRequestException('Invalid order id');
      }
      return this.eventsService.handleGrabOrder(foundPayeeId, orderId);
    }

    throw new BadRequestException('未知的请求类型');
  }
}

import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EventsService } from './events.service';
import { PaymentMethod } from '@prisma/client';
import { randomUUID } from 'crypto';
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  private parseAdminIdFromCookie(
    cookies: Record<string, string>,
  ): number | null {
    const adminCookie = cookies['admin'];
    if (!adminCookie) return null;
    try {
      const parsed: unknown = JSON.parse(adminCookie);
      if (typeof parsed === 'object' && parsed !== null && 'id' in parsed) {
        const idVal = (parsed as { id?: unknown }).id;
        const n = Number(idVal);
        if (Number.isFinite(n)) return n;
      }
    } catch {
      // ignore
    }
    return null;
  }

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

  @Get()
  async sse(
    @Query('type') type: 'payee' | 'customer',
    @Query('user_id') userIdQuery: string,
    @Query('admin_id') adminIdQuery: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!type || (type !== 'payee' && type !== 'customer')) {
      throw new BadRequestException('Missing or invalid type');
    }

    let payeeId: number | undefined;
    if (type === 'payee') {
      // 从查询参数获取admin_id
      const adminId = adminIdQuery ? Number(adminIdQuery) : undefined;
      if (!adminId || !Number.isFinite(adminId)) {
        throw new BadRequestException('Missing or invalid admin_id');
      }

      const foundPayeeId = await this.eventsService.findPayeeIdByAdmin(adminId);
      if (!foundPayeeId) {
        throw new BadRequestException('该管理员未绑定收款人');
      }
      payeeId = foundPayeeId;
    }
    if (type === 'customer' && !userIdQuery) {
      throw new BadRequestException('Missing user_id');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // CORS for SSE with credentials
    const originHeader = req.headers.origin;
    const origin = typeof originHeader === 'string' ? originHeader : undefined;
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // prevent proxies from buffering
    res.setHeader('X-Accel-Buffering', 'no');

    const userId = userIdQuery ? Number(userIdQuery) : undefined;

    const connectionId = this.eventsService.addConnection(type, res, {
      payeeId,
      userId,
    });

    // initial connected message
    res.write(
      `data: ${JSON.stringify({
        type: 'connected',
        connectionId,
        data: { payeeId, userId },
      })}\n\n`,
    );

    req.on('close', () => {
      this.eventsService.removeConnection(connectionId, type, {
        payeeId,
        userId,
      });
    });
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

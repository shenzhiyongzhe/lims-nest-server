import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PayeesService } from './payees.service';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';
import { ResponseHelper } from 'src/common/response-helper';
import { CreatePayeeDto } from './create-payee.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaymentMethod } from '@prisma/client';
import type { Express } from 'express';

@Controller('payees')
export class PayeesController {
  constructor(private readonly payeesService: PayeesService) {}
  @Get()
  async findAll(): Promise<ApiResponseDto> {
    const payees = await this.payeesService.findAll();
    const resData = payees.map((p) => this.payeesService.toResponse(p));
    return ResponseHelper.success(resData, '获取收款人成功');
  }

  // GET /payees/qrcode?payee_id=&payment_method=&active=
  @Get('qrcode')
  async getQRCodes(
    @Query('payee_id') payee_id: number,
    @Query('payment_method') payment_method?: PaymentMethod,
    @Query('active') active?: string,
  ): Promise<ApiResponseDto> {
    const rows = await this.payeesService.findQRCodes({
      payee_id: payee_id,
      payment_method,
      active: active !== undefined ? active === 'true' : undefined,
    });
    return ResponseHelper.success(rows, '获取二维码成功');
  }

  // POST /payees/qrcode
  @UseGuards(AuthGuard, RolesGuard)
  @Post('qrcode')
  async createQRCode(
    @CurrentUser() user: { id: number },
    @Body() body: { qrcode_type: PaymentMethod; qrcode_url: string },
  ): Promise<ApiResponseDto> {
    const created = await this.payeesService.createQRCode(user.id, body);
    return ResponseHelper.success(created, '创建二维码成功');
  }
  @Get(':id')
  async findById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponseDto> {
    const payee = await this.payeesService.findById(id);
    if (!payee) {
      throw new NotFoundException('收款人不存在');
    }
    const resData = this.payeesService.toResponse(payee);
    return ResponseHelper.success(resData, '获取收款人成功');
  }
  @Post()
  async create(@Body() data: CreatePayeeDto): Promise<ApiResponseDto> {
    const payee = await this.payeesService.create(data);
    const resData = this.payeesService.toResponse(payee);
    return ResponseHelper.success(resData, '创建收款人成功');
  }
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: CreatePayeeDto,
  ): Promise<ApiResponseDto> {
    const payee = await this.payeesService.update(id, data);
    const resData = this.payeesService.toResponse(payee);
    return ResponseHelper.success(resData, '更新收款人成功');
  }
  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<ApiResponseDto> {
    const payee = await this.payeesService.delete(id);
    if (!payee) {
      throw new NotFoundException('收款人不存在');
    }
    const resData = this.payeesService.toResponse(payee);
    return ResponseHelper.success(resData, '删除收款人成功');
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFileDto,
    @CurrentUser() user: { id: number },
  ): Promise<ApiResponseDto> {
    try {
      const { qrcode_type } = body;
      if (!qrcode_type) {
        throw new BadRequestException('缺少必要参数');
      }
      const created = await this.payeesService.uploadAndCreateQRCode(
        file,
        qrcode_type,
        user.id,
      );
      return ResponseHelper.success(created, '上传并创建二维码成功');
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('上传失败');
    }
  }
}

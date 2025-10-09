import { Controller, Get } from '@nestjs/common';
import { ResponseHelper } from './response-helper';

@Controller('example')
export class ExampleController {
  @Get('success')
  getSuccess() {
    return ResponseHelper.success({ id: 1, name: 'test' }, '获取成功');
  }

  @Get('error')
  getError() {
    return ResponseHelper.error('获取失败', 400);
  }

  @Get('direct')
  getDirect() {
    // 直接返回格式
    return {
      code: 200,
      message: '成功',
      data: [{ id: 1, name: 'test' }],
    };
  }
}

import {
  Controller,
  Get,
  Query,
  UseGuards,
  Post,
  Body,
  Delete,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { LoanAccountRolesService } from './loanAccountRoles.service';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ManagementRoles } from '@prisma/client';
import { CreateLoanAccountRoleDto } from './dto/create-loan-account-role.dto';

@Controller('loan-account-roles')
@UseGuards(AuthGuard, RolesGuard)
export class LoanAccountRolesController {
  constructor(
    private readonly loanAccountRolesService: LoanAccountRolesService,
  ) {}

  @Get('users')
  async findUsersByRole(
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @CurrentUser() user: any,
  ): Promise<ApiResponseDto> {
    const users = await this.loanAccountRolesService.findUsersByRole(
      user.id,
      user.role,
      page,
      pageSize,
    );
    return ResponseHelper.success(users, `获取${user.role}负责的用户成功`);
  }

  @Get('loan-accounts')
  async findLoanAccountsByRole(
    @CurrentUser() user: any,
  ): Promise<ApiResponseDto> {
    const loanAccounts =
      await this.loanAccountRolesService.findLoanAccountsByRole(
        user.id,
        user.role,
      );
    return ResponseHelper.success(
      loanAccounts,
      `获取${user.role}负责的贷款账户成功`,
    );
  }

  @Post()
  async createRole(
    @Body() body: CreateLoanAccountRoleDto,
    @CurrentUser() user: any,
  ): Promise<ApiResponseDto> {
    const role = await this.loanAccountRolesService.createRole(
      body.loan_account_id,
      body.admin_id,
      body.role_type,
    );
    return ResponseHelper.success(role, '创建角色关系成功');
  }

  @Delete(':loanAccountId/:adminId/:roleType')
  @Roles(ManagementRoles.负责人)
  async deleteRole(
    @Param('loanAccountId') loanAccountId: string,
    @Param('adminId', ParseIntPipe) adminId: number,
    @Param('roleType') roleType: string,
  ): Promise<ApiResponseDto> {
    await this.loanAccountRolesService.deleteRole(
      loanAccountId,
      adminId,
      roleType,
    );
    return ResponseHelper.success(null, '删除角色关系成功');
  }
}

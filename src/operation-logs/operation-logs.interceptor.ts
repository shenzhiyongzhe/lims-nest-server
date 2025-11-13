import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { OperationLogsService } from './operation-logs.service';
import { OperationType } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user: { id: number; role: string };
  ip: string;
  oldData?: any; // 用于存储更新前的完整数据（由 Controller 设置）
}

@Injectable()
export class OperationLogsInterceptor implements NestInterceptor {
  constructor(private readonly operationLogsService: OperationLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const handler = context.getHandler();
    const controller = context.getClass();

    // Extract entity type from controller name
    const controllerName = controller.name;
    let entityType = '';

    if (controllerName.includes('LoanAccounts')) {
      entityType = 'LoanAccount';
    } else if (controllerName.includes('RepaymentSchedules')) {
      entityType = 'RepaymentSchedule';
    } else {
      // Not a tracked entity, skip logging
      return next.handle();
    }

    // Determine operation type based on HTTP method
    const method = request.method;
    let operationType: OperationType | null = null;

    if (method === 'POST') {
      operationType = OperationType.CREATE;
    } else if (method === 'PUT' || method === 'PATCH') {
      operationType = OperationType.UPDATE;
    } else if (method === 'DELETE') {
      operationType = OperationType.DELETE;
    } else {
      // Not a tracked operation (GET requests)
      return next.handle();
    }

    // Get user info
    const user = request.user;
    if (!user) {
      return next.handle();
    }

    // Get IP address
    const ip = request.headers['x-forwarded-for'] || request.ip || '';
    const ipAddress = Array.isArray(ip) ? ip[0] : ip;

    return next.handle().pipe(
      tap(async (response) => {
        try {
          // Extract entity ID from response or request
          let entityId = '';

          if (response && response.data) {
            if (response.data.id) {
              entityId = String(response.data.id);
            } else if (
              Array.isArray(response.data) &&
              response.data.length > 0 &&
              response.data[0].id
            ) {
              entityId = String(response.data[0].id);
            }
          }

          // For DELETE, try to get ID from URL params
          if (!entityId && method === 'DELETE') {
            const url = request.url;
            const matches = url.match(/\/([^\/]+)$/);
            if (matches && matches[1]) {
              entityId = matches[1];
            }
          }

          if (!entityId) {
            // Can't log without entity ID
            return;
          }

          // Get admin username (need to query from DB)
          const adminUsername = `admin_${user.id}`; // Simplified for now

          // For UPDATE operations, try to get old_data from request.oldData (set by controller)
          // This must be read AFTER the controller has executed, so we read it here in tap()
          let oldData: string | undefined;
          if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
            if (request.oldData) {
              // Use oldData set by controller (complete data before update)
              oldData = JSON.stringify(request.oldData);
            } else {
              // Fall back to request body (may be incomplete)
              oldData = JSON.stringify(request.body);
            }
          }

          // For UPDATE operations, use response.data as new_data (complete data after update)
          // For CREATE operations, use response.data as new_data
          // For DELETE operations, new_data is undefined
          const newData =
            method !== 'DELETE' && response && response.data
              ? JSON.stringify(response.data)
              : undefined;

          // Log the operation
          await this.operationLogsService.logOperation({
            entity_type: entityType,
            entity_id: entityId,
            operation_type: operationType,
            admin_id: user.id,
            admin_username: adminUsername,
            old_data: oldData,
            new_data: newData,
            ip_address: ipAddress,
          });
        } catch (error) {
          console.error('操作日志拦截器错误:', error);
          // Don't throw - logging should not break the main operation
        }
      }),
    );
  }
}

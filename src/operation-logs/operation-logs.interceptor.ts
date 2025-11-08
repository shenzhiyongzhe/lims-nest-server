import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { OperationLogsService } from './operation-logs.service';
import { OperationType } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user: { id: number; role: string };
  ip?: string;
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

    // Store request body as old_data for UPDATE/DELETE operations
    const oldData =
      method === 'PUT' || method === 'PATCH' || method === 'DELETE'
        ? JSON.stringify(request.body)
        : undefined;

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

          // Log the operation
          await this.operationLogsService.logOperation({
            entity_type: entityType,
            entity_id: entityId,
            operation_type: operationType,
            admin_id: user.id,
            admin_username: adminUsername,
            old_data: oldData,
            new_data:
              method !== 'DELETE' ? JSON.stringify(response.data) : undefined,
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

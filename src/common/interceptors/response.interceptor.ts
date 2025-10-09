import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponseDto } from '../dto/api-response.dto';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponseDto<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponseDto<T>> {
    return next.handle().pipe(
      map((data) => {
        // 如果数据已经是 ApiResponseDto 格式，直接返回
        if (data && typeof data === 'object' && 'code' in data) {
          return data as ApiResponseDto<T>;
        }

        // 否则包装成统一格式
        return ApiResponseDto.success(data) as ApiResponseDto<T>;
      }),
    );
  }
}

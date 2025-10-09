export class ApiResponseDto<T = any> {
  code: number;
  message: string;
  data: T;

  constructor(code: number, message: string, data: T) {
    this.code = code;
    this.message = message;
    this.data = data;
  }

  static success<T>(data: T, message = '成功'): ApiResponseDto<T> {
    return new ApiResponseDto(200, message, data);
  }

  static error(message = '失败', code = 500): ApiResponseDto<null> {
    return new ApiResponseDto(code, message, null);
  }
}

export class ResponseHelper {
  static success<T>(
    data: T,
    message = '成功',
  ): {
    code: number;
    message: string;
    data: T;
  } {
    return {
      code: 200,
      message,
      data,
    };
  }

  static error(
    message = '失败',
    code = 500,
  ): {
    code: number;
    message: string;
    data: null;
  } {
    return {
      code,
      message,
      data: null,
    };
  }
}

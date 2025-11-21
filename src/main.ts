import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { IoAdapter } from '@nestjs/platform-socket.io';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 配置CORS
  app.enableCors({
    origin: (origin, callback) => {
      // 允许的源列表
      const allowedOrigins = [
        'http://www.ddw.xn--fiqs8s',
        'http://www.ddw.中国',
        'https://www.ddw.xn--fiqs8s',
        'https://www.ddw.中国',
        'http://114.67.174.175',
        'https://114.67.174.175',
        // 开发环境允许所有源（可选）
        ...(process.env.NODE_ENV === 'development' ? ['*'] : []),
      ];

      // 如果没有 origin（比如同源请求或 Postman），允许通过
      if (!origin) {
        return callback(null, true);
      }

      // 检查是否在允许列表中
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(null, true); // 临时允许所有源，生产环境应该更严格
      }
    },
    credentials: true, // 允许发送cookie
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    maxAge: 86400, // 预检请求缓存时间（24小时）
    preflightContinue: false, // 不继续处理预检请求，直接返回
    optionsSuccessStatus: 204, // 预检请求成功状态码
  });

  // 配置cookie-parser
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 注册全局响应拦截器
  app.useGlobalInterceptors(new ResponseInterceptor());

  // 配置WebSocket支持
  app.useWebSocketAdapter(new IoAdapter(app));

  await app.listen(process.env.PORT ?? 3000);
  // 捕获退出信号（Ctrl+C 或 nodemon 重启）
  const shutdown = () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();

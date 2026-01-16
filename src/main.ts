import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { SocketIOAdapter } from './socket-io.adapter';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 设置全局前缀
  // app.setGlobalPrefix('api');

  // 配置CORS
  app.enableCors({
    origin: [
      'https://xinde8888.com',
      'https://www.xinde8888.com',
      'http://localhost:3000',
      'http://localhost:3001',
      // 开发环境可以更宽松
      ...(process.env.NODE_ENV === 'development' ? ['*'] : []),
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    maxAge: 86400,
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

  // 配置WebSocket支持（使用自定义Adapter以支持CORS）
  app.useWebSocketAdapter(new SocketIOAdapter(app));

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

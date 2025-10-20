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
    origin: true,
    credentials: true, // 允许发送cookie
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
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

  console.log(`Server is running on port ${process.env.PORT ?? 3000}`);
}

bootstrap();

import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { INestApplicationContext } from '@nestjs/common';

export class SocketIOAdapter extends IoAdapter {
  constructor(app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const isProduction = process.env.NODE_ENV === 'production';

    const serverOptions: Partial<ServerOptions> = {
      path: options?.path ?? '/socket.io/',
      cors: {
        origin: isProduction
          ? ['https://xinde8888.com', 'https://www.xinde8888.com']
          : ['http://localhost:3000', 'http://localhost:3001', '*'],
        credentials: true,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
      },
      transports: ['websocket', 'polling'],
      allowEIO3: true,
      pingTimeout: 60000,
      pingInterval: 25000,
      allowRequest: (req: any, callback: any) => {
        callback(null, true);
      },
    };

    // 合并 options，过滤掉 undefined 值
    if (options) {
      Object.keys(options).forEach((key) => {
        const value = (options as any)[key];
        if (value !== undefined) {
          (serverOptions as any)[key] = value;
        }
      });
    }

    return super.createIOServer(port, serverOptions as ServerOptions);
  }
}

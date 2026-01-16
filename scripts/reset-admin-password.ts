/**
 * 紧急管理员密码重置脚本
 *
 * 使用方法：
 * 1. 直接运行：npx ts-node scripts/reset-admin-password.ts <username>
 * 2. 或者编译后运行：npm run build && node dist/scripts/reset-admin-password.js <username>
 *
 * 示例：
 * npx ts-node scripts/reset-admin-password.ts admin
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function resetAdminPassword(username: string) {
  try {
    console.log(`正在查找管理员: ${username}...`);

    // 查找管理员
    const admin = await prisma.admin.findFirst({
      where: { username },
    });

    if (!admin) {
      console.error(`❌ 错误: 未找到用户名为 "${username}" 的管理员`);
      process.exit(1);
    }

    console.log(
      `✅ 找到管理员: ID=${admin.id}, 用户名=${admin.username}, 角色=${admin.role}`,
    );

    // 重置密码为 123456
    const defaultPassword = '123456';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const updated = await prisma.admin.update({
      where: { id: admin.id },
      data: {
        password: hashedPassword,
        token_version: { increment: 1 }, // 使旧token失效
        failed_login_attempts: 0, // 重置失败次数
        locked_until: null, // 解除锁定
      },
    });

    console.log(`\n✅ 密码重置成功！`);
    console.log(`   用户名: ${updated.username}`);
    console.log(`   新密码: ${defaultPassword}`);
    console.log(`   角色: ${updated.role}`);
    console.log(`\n⚠️  请立即登录系统并修改密码！`);
  } catch (error) {
    console.error('❌ 重置密码失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 获取命令行参数
const username = process.argv[2];

if (!username) {
  console.error('❌ 错误: 请提供管理员用户名');
  console.log('\n使用方法:');
  console.log('  npx ts-node scripts/reset-admin-password.ts <username>');
  console.log('\n示例:');
  console.log('  npx ts-node scripts/reset-admin-password.ts admin');
  process.exit(1);
}

// 执行重置
resetAdminPassword(username);

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedStatistics() {
  console.log('🌱 开始生成测试统计数据...');

  try {
    // 获取所有管理员ID（collector 和 risk_controller 角色）
    const roles = await prisma.loanAccountRole.findMany({
      where: {
        role_type: { in: ['collector', 'risk_controller'] },
      },
      include: {
        admin: true,
      },
      distinct: ['admin_id', 'role_type'],
    });

    if (roles.length === 0) {
      console.log('⚠️ 没有找到任何 collector 或 risk_controller 角色，跳过数据生成');
      return;
    }

    // 生成最近30天的测试数据
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 30);

    for (let i = 0; i < 30; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      date.setHours(0, 0, 0, 0);

      // 为每个角色生成数据
      for (const role of roles) {
        // 生成随机数据
        const newInStockAmount = Math.random() * 5000 + 500; // 500-5500 新增在库
        const clearedOffAmount = Math.random() * 3000 + 200; // 200-3200 离库结清
        const totalReceived = Math.random() * 8000 + 1000; // 1000-9000 已收
        const totalUnpaid = Math.random() * 4000 + 500; // 500-4500 未收
        const totalHandlingFee = Math.random() * 500 + 50; // 50-550 后扣
        const totalFines = Math.random() * 200 + 20; // 20-220 罚金
        const negotiatedCount = Math.floor(Math.random() * 5); // 0-4 协商
        const blacklistCount = Math.floor(Math.random() * 3); // 0-2 黑名单

        // 检查是否已存在该日期和角色的数据
        const existing = await prisma.dailyStatistics.findFirst({
          where: {
            admin_id: role.admin_id,
            date,
            role: role.role_type,
          },
        });

        if (!existing) {
          await prisma.dailyStatistics.create({
            data: {
              admin_id: role.admin_id,
              admin_name: role.admin.username,
              date,
              role: role.role_type,
              new_in_stock_amount: newInStockAmount,
              cleared_off_amount: clearedOffAmount,
              total_received: totalReceived,
              total_unpaid: totalUnpaid,
              total_handling_fee: totalHandlingFee,
              total_fines: totalFines,
              negotiated_count: negotiatedCount,
              blacklist_count: blacklistCount,
            },
          });

          console.log(
            `✅ 已创建 ${date.toISOString().split('T')[0]} ${role.admin.username}(${role.role_type}) 的统计数据`,
          );
        } else {
          console.log(
            `⏭️  ${date.toISOString().split('T')[0]} ${role.admin.username}(${role.role_type}) 的统计数据已存在，跳过`,
          );
        }
      }
    }

    console.log('🎉 测试统计数据生成完成！');
  } catch (error) {
    console.error('❌ 生成测试数据失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  seedStatistics();
}

export { seedStatistics };

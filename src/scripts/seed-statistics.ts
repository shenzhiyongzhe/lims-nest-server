import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedStatistics() {
  console.log('🌱 开始生成测试统计数据...');

  try {
    // 生成最近30天的测试数据
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 30);

    for (let i = 0; i < 30; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      date.setHours(0, 0, 0, 0);

      // 生成随机数据
      const baseAmount = Math.random() * 10000 + 1000; // 1000-11000 基础金额
      const payeeAmount = baseAmount * (0.6 + Math.random() * 0.3); // 60-90% 的收款人金额
      const collectorAmount = baseAmount * (0.1 + Math.random() * 0.2); // 10-30% 的负责人金额
      const riskControllerAmount = baseAmount * (0.05 + Math.random() * 0.15); // 5-20% 的风控人金额
      const transactionCount = Math.floor(Math.random() * 20) + 5; // 5-25 笔交易

      // 检查是否已存在该日期的数据
      const existing = await prisma.dailyStatistics.findUnique({
        where: { date },
      });

      if (!existing) {
        await prisma.dailyStatistics.create({
          data: {
            date,
            total_amount: payeeAmount,
            payee_amount: payeeAmount,
            collector_amount: collectorAmount,
            risk_controller_amount: riskControllerAmount,
            transaction_count: transactionCount,
          },
        });

        console.log(`✅ 已创建 ${date.toISOString().split('T')[0]} 的统计数据`);
      } else {
        console.log(
          `⏭️  ${date.toISOString().split('T')[0]} 的统计数据已存在，跳过`,
        );
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

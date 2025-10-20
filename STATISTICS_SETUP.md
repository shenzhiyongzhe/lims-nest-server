# 统计数据功能设置指南

## 概述

本功能为LIMS系统添加了完整的统计数据功能，包括每日收款统计、角色分析、趋势图表等。

## 数据库迁移

### 1. 运行数据库迁移

```bash
cd lims-nest-server
npx prisma migrate dev --name add_daily_statistics
```

### 2. 生成Prisma客户端

```bash
npx prisma generate
```

## 功能特性

### 后端功能

- **每日统计计算**: 自动计算每日收款数据
- **角色分析**: 分别统计收款人、负责人、风控人的收款金额
- **定时任务**: 每天午夜自动计算前一天的数据
- **API接口**: 提供RESTful API获取统计数据

### 前端功能

- **统计概览**: 显示总金额、平均金额、交易笔数等关键指标
- **趋势图表**: 使用shadcn/ui + recharts展示折线图
- **数据表格**: 详细的每日数据表格
- **日期筛选**: 支持预设范围和自定义日期范围
- **数据导出**: 支持CSV格式导出

## API接口

### 获取统计数据

```
GET /api/statistics?range=last_7_days&startDate=2024-01-01&endDate=2024-01-31
```

参数：

- `range`: 预设范围 (last_7_days, last_30_days, last_90_days, custom)
- `startDate`: 开始日期 (YYYY-MM-DD)
- `endDate`: 结束日期 (YYYY-MM-DD)

### 手动计算统计数据

```
POST /api/statistics/calculate
{
  "date": "2024-01-15"
}
```

### 批量计算统计数据

```
POST /api/statistics/calculate-range
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31"
}
```

## 测试数据

### 生成测试数据

```bash
cd lims-nest-server
npm run seed:statistics
```

这将生成最近30天的模拟统计数据。

## 定时任务

系统会自动运行以下定时任务：

- **每日午夜**: 计算前一天的统计数据
- **每日凌晨1点**: 检查并计算最近30天内缺失的统计数据

## 前端组件

### 主要组件

- `StatisticsChart`: 趋势图表组件
- `StatisticsTable`: 数据表格组件
- `StatisticsSummary`: 统计概览组件
- `DateRangeSelector`: 日期范围选择器

### 依赖库

- `recharts`: 图表库
- `shadcn/ui`: UI组件库
- `lucide-react`: 图标库

## 部署注意事项

1. **数据库迁移**: 确保在生产环境运行迁移
2. **定时任务**: 确保服务器时间正确
3. **权限设置**: 确保API接口有适当的权限控制
4. **性能优化**: 大量数据时考虑添加索引

## 故障排除

### 常见问题

1. **统计数据为空**: 检查是否有RepaymentRecord数据
2. **图表不显示**: 检查recharts是否正确安装
3. **API错误**: 检查后端服务是否正常运行

### 日志查看

```bash
# 查看统计服务日志
tail -f logs/statistics.log

# 查看定时任务日志
tail -f logs/cron.log
```

## 开发指南

### 添加新的统计维度

1. 在`DailyStatistics`模型中添加字段
2. 更新`StatisticsService.calculateDailyStatistics`方法
3. 更新前端组件显示新字段

### 自定义图表样式

修改`StatisticsChart.tsx`中的`chartColors`和样式配置。

### 添加新的日期范围

在`DateRangeSelector.tsx`中添加新的选项。

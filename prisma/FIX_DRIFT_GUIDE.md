# 修复 Prisma 迁移 Drift 问题指南

当手动修改数据库后导致迁移失败时，可以使用以下方法修复。

## 问题诊断

从错误信息可以看到：

- 迁移 `20260108024151_` 失败
- 检测到 drift：数据库 schema 与迁移历史不同步
- `admins` 表的 `role` 列类型已改变

## 解决方案

### 方案一：如果数据库已经手动更新到正确状态（推荐）

如果你已经手动执行了 SQL 更新了数据库，只需要告诉 Prisma 这个迁移已经应用了。

#### 步骤：

1. **验证数据库当前状态**：

```sql
-- 检查 role 列的当前定义
SHOW COLUMNS FROM `admins` LIKE 'role';

-- 检查数据是否已经更新为英文枚举值
SELECT `role`, COUNT(*) as count
FROM `admins`
GROUP BY `role`;
```

2. **如果数据库已经是正确状态（英文枚举值），标记迁移为已应用**：

```bash
cd lims-nest-server
npx prisma migrate resolve --applied 20260108024151_
```

3. **生成 Prisma Client**：

```bash
npx prisma generate
```

4. **验证迁移状态**：

```bash
npx prisma migrate status
```

---

### 方案二：如果数据库还没有更新，需要完成迁移

如果数据库中的枚举值还是中文，需要先完成数据迁移。

#### 步骤：

1. **第一步：添加新的英文枚举值（保留中文）**

```sql
-- 先添加英文枚举值，保留中文值
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM(
  '管理员',
  '财务员',
  '风控人',
  '负责人',
  '收款人',
  '打款人',
  'ADMIN',
  'FINANCIAL',
  'RISK_CONTROLLER',
  'COLLECTOR',
  'PAYEE',
  'PAYER'
) NOT NULL;
```

2. **第二步：更新数据（将中文值改为英文值）**

```sql
-- 更新所有记录为英文枚举值
UPDATE `admins` SET `role` = 'ADMIN' WHERE `role` = '管理员';
UPDATE `admins` SET `role` = 'FINANCIAL' WHERE `role` = '财务员';
UPDATE `admins` SET `role` = 'RISK_CONTROLLER' WHERE `role` = '风控人';
UPDATE `admins` SET `role` = 'COLLECTOR' WHERE `role` = '负责人';
UPDATE `admins` SET `role` = 'PAYEE' WHERE `role` = '收款人';
UPDATE `admins` SET `role` = 'PAYER' WHERE `role` = '打款人';
```

3. **第三步：删除中文枚举值**

```sql
-- 删除中文枚举值，只保留英文
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM(
  'ADMIN',
  'FINANCIAL',
  'RISK_CONTROLLER',
  'COLLECTOR',
  'PAYEE',
  'PAYER'
) NOT NULL;
```

4. **第四步：删除 phone 列（如果迁移中有这个操作）**

```sql
-- 检查 phone 列是否存在
SHOW COLUMNS FROM `admins` LIKE 'phone';

-- 如果存在且需要删除
ALTER TABLE `admins` DROP COLUMN `phone`;
```

5. **标记迁移为已应用**：

```bash
npx prisma migrate resolve --applied 20260108024151_
```

6. **生成 Prisma Client**：

```bash
npx prisma generate
```

---

### 方案三：使用 prisma db pull 同步当前数据库状态

如果你想保持数据库当前状态，可以拉取当前数据库 schema。

#### 步骤：

1. **备份当前 schema.prisma**：

```bash
cp prisma/schema.prisma prisma/schema.prisma.backup
```

2. **拉取当前数据库状态**：

```bash
npx prisma db pull
```

3. **检查生成的 schema**，确保它符合你的需求

4. **标记失败的迁移为已应用**：

```bash
npx prisma migrate resolve --applied 20260108024151_
```

5. **创建新的迁移来同步差异**（如果有）：

```bash
npx prisma migrate dev --name sync_database_state
```

---

### 方案四：重置迁移历史（不推荐，会丢失迁移历史）

如果以上方法都不行，可以重置迁移历史，但**会丢失所有迁移记录**。

#### 步骤：

1. **备份数据库**（重要！）

2. **删除迁移历史**：

```bash
# 删除 migrations 目录（可选，不推荐）
# rm -rf prisma/migrations
```

3. **创建新的初始迁移**：

```bash
npx prisma migrate dev --name init
```

---

## 推荐操作流程

根据你的情况，推荐使用以下流程：

### 快速检查脚本

创建一个 SQL 脚本来检查当前状态：

```sql
-- 1. 检查 role 列的当前定义
SHOW COLUMNS FROM `admins` LIKE 'role';

-- 2. 检查数据分布
SELECT `role`, COUNT(*) as count
FROM `admins`
GROUP BY `role`;

-- 3. 检查是否有中文值
SELECT COUNT(*) as chinese_count
FROM `admins`
WHERE `role` IN ('管理员', '财务员', '风控人', '负责人', '收款人', '打款人');
```

### 完整修复脚本

如果数据库还是中文值，使用这个完整脚本：

```sql
-- ============================================
-- 完整迁移脚本：将中文枚举值改为英文
-- ============================================

-- 步骤 1: 添加英文枚举值（保留中文）
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM(
  '管理员', '财务员', '风控人', '负责人', '收款人', '打款人',
  'ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYER'
) NOT NULL;

-- 步骤 2: 更新数据
UPDATE `admins` SET `role` = 'ADMIN' WHERE `role` = '管理员';
UPDATE `admins` SET `role` = 'FINANCIAL' WHERE `role` = '财务员';
UPDATE `admins` SET `role` = 'RISK_CONTROLLER' WHERE `role` = '风控人';
UPDATE `admins` SET `role` = 'COLLECTOR' WHERE `role` = '负责人';
UPDATE `admins` SET `role` = 'PAYEE' WHERE `role` = '收款人';
UPDATE `admins` SET `role` = 'PAYER' WHERE `role` = '打款人';

-- 步骤 3: 删除中文枚举值
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM(
  'ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYER'
) NOT NULL;

-- 步骤 4: 删除 phone 列（如果需要）
-- ALTER TABLE `admins` DROP COLUMN `phone`;
```

执行完 SQL 后，运行：

```bash
npx prisma migrate resolve --applied 20260108024151_
npx prisma generate
```

---

## 验证步骤

修复后，验证一切正常：

1. **检查迁移状态**：

```bash
npx prisma migrate status
```

应该显示 "Database schema is up to date!"

2. **检查数据库**：

```sql
SHOW COLUMNS FROM `admins` LIKE 'role';
SELECT `role`, COUNT(*) FROM `admins` GROUP BY `role`;
```

3. **测试应用**：
   确保应用能正常启动，Prisma Client 能正常工作。

---

## 常见问题

### Q: 执行 `prisma migrate resolve` 后还是报错？

A: 确保数据库状态与 schema.prisma 完全一致。使用 `prisma db pull` 检查差异。

### Q: 如何回滚迁移？

A: 使用 `npx prisma migrate resolve --rolled-back 20260108024151_`，但需要手动恢复数据库状态。

### Q: 迁移历史丢失了怎么办？

A: 如果迁移历史丢失，可以使用 `prisma db pull` 拉取当前数据库状态，然后创建新的迁移。

---

## 预防措施

1. **不要手动修改数据库**：尽量通过 Prisma 迁移来修改
2. **使用 `--create-only`**：创建迁移后先检查 SQL，再执行
3. **备份数据库**：执行迁移前务必备份
4. **测试环境验证**：先在测试环境验证迁移

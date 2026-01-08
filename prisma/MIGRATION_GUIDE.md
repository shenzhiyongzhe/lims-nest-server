# MySQL 枚举类型迁移指南

当需要修改 Prisma schema 中的枚举类型时，MySQL 的 ENUM 类型需要特殊处理。本指南说明如何在不删除数据表的情况下安全地迁移枚举类型。

## 目录

1. [添加新的枚举值](#添加新的枚举值)
2. [删除枚举值](#删除枚举值)
3. [重命名枚举值](#重命名枚举值)
4. [完整迁移流程](#完整迁移流程)
5. [示例：修改 ManagementRoles 枚举](#示例修改-managementroles-枚举)

---

## 添加新的枚举值

这是最简单的场景，只需要在 ENUM 中添加新值。

### 步骤：

1. **修改 schema.prisma**，添加新的枚举值：

```prisma
enum ManagementRoles {
  ADMIN
  FINANCIAL
  RISK_CONTROLLER
  COLLECTOR
  PAYEE
  PAYER
  NEW_ROLE  // 新增的角色
}
```

2. **创建迁移脚本**（在 `prisma/migrations` 目录下创建新的迁移文件）：

```sql
-- 添加新的枚举值
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM('ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYER', 'NEW_ROLE') NOT NULL;
```

3. **执行迁移**：

```bash
# 使用 Prisma migrate
npx prisma migrate dev --name add_new_role_to_management_roles

# 或者手动执行 SQL
mysql -u your_user -p your_database < prisma/migrations/xxxxx_add_new_role/migration.sql
```

---

## 删除枚举值

删除枚举值需要先确保没有数据使用该值，然后才能删除。

### 步骤：

1. **检查数据**：

```sql
-- 检查是否有数据使用要删除的枚举值
SELECT COUNT(*) FROM `admins` WHERE `role` = 'OLD_ROLE';
```

2. **更新数据**（如果有数据使用该值）：

```sql
-- 将使用旧值的记录更新为新值
UPDATE `admins` SET `role` = 'NEW_ROLE' WHERE `role` = 'OLD_ROLE';
```

3. **修改 schema.prisma**，删除枚举值：

```prisma
enum ManagementRoles {
  ADMIN
  FINANCIAL
  RISK_CONTROLLER
  COLLECTOR
  PAYEE
  PAYER
  // OLD_ROLE 已删除
}
```

4. **创建迁移脚本**：

```sql
-- 删除枚举值
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM('ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYER') NOT NULL;
```

5. **执行迁移**：

```bash
npx prisma migrate dev --name remove_old_role_from_management_roles
```

---

## 重命名枚举值

重命名需要先添加新值，更新数据，然后删除旧值。

### 步骤：

1. **修改 schema.prisma**，添加新值（保留旧值）：

```prisma
enum ManagementRoles {
  ADMIN
  FINANCIAL
  RISK_CONTROLLER
  COLLECTOR
  PAYEE
  PAYER
  OLD_ROLE  // 旧值，稍后删除
  NEW_ROLE  // 新值
}
```

2. **创建迁移脚本 - 第一步：添加新值**：

```sql
-- 第一步：添加新的枚举值
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM('ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYER', 'OLD_ROLE', 'NEW_ROLE') NOT NULL;
```

3. **更新数据**：

```sql
-- 第二步：将所有旧值更新为新值
UPDATE `admins` SET `role` = 'NEW_ROLE' WHERE `role` = 'OLD_ROLE';
```

4. **修改 schema.prisma**，删除旧值：

```prisma
enum ManagementRoles {
  ADMIN
  FINANCIAL
  RISK_CONTROLLER
  COLLECTOR
  PAYEE
  PAYER
  NEW_ROLE  // 只保留新值
}
```

5. **创建迁移脚本 - 第二步：删除旧值**：

```sql
-- 第三步：删除旧的枚举值
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM('ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYER', 'NEW_ROLE') NOT NULL;
```

6. **执行迁移**：

```bash
# 执行第一步迁移
npx prisma migrate dev --name add_new_role_value

# 手动执行数据更新 SQL
# UPDATE `admins` SET `role` = 'NEW_ROLE' WHERE `role` = 'OLD_ROLE';

# 执行第二步迁移
npx prisma migrate dev --name remove_old_role_value
```

---

## 完整迁移流程

### 方法一：使用 Prisma Migrate（推荐）

1. **修改 schema.prisma**
2. **创建迁移**：

```bash
npx prisma migrate dev --name your_migration_name --create-only
```

这会创建一个迁移文件，但不会执行。

3. **编辑迁移文件**：
   打开生成的迁移文件（在 `prisma/migrations/xxxxx_your_migration_name/migration.sql`），修改 SQL 语句以正确处理枚举类型。

4. **执行迁移**：

```bash
npx prisma migrate dev
```

### 方法二：手动创建迁移文件

1. **创建迁移目录**：

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_your_migration_name
```

2. **创建 migration.sql 文件**：

```sql
-- 在这里编写你的 ALTER TABLE 语句
ALTER TABLE `table_name`
MODIFY COLUMN `enum_column` ENUM('value1', 'value2', 'value3') NOT NULL;
```

3. **标记迁移为已应用**（如果手动执行了 SQL）：

```bash
npx prisma migrate resolve --applied xxxxx_your_migration_name
```

4. **生成 Prisma Client**：

```bash
npx prisma generate
```

---

## 示例：修改 ManagementRoles 枚举

假设要将 `PAYER` 重命名为 `PAYMENT_OFFICER`：

### 步骤 1：添加新枚举值

**schema.prisma**:

```prisma
enum ManagementRoles {
  ADMIN
  FINANCIAL
  RISK_CONTROLLER
  COLLECTOR
  PAYEE
  PAYER
  PAYMENT_OFFICER  // 新增
}
```

**迁移 SQL**:

```sql
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM('ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYER', 'PAYMENT_OFFICER') NOT NULL;
```

### 步骤 2：更新数据

```sql
UPDATE `admins` SET `role` = 'PAYMENT_OFFICER' WHERE `role` = 'PAYER';
```

### 步骤 3：删除旧枚举值

**schema.prisma**:

```prisma
enum ManagementRoles {
  ADMIN
  FINANCIAL
  RISK_CONTROLLER
  COLLECTOR
  PAYEE
  PAYMENT_OFFICER  // 只保留新值
}
```

**迁移 SQL**:

```sql
ALTER TABLE `admins`
MODIFY COLUMN `role` ENUM('ADMIN', 'FINANCIAL', 'RISK_CONTROLLER', 'COLLECTOR', 'PAYEE', 'PAYMENT_OFFICER') NOT NULL;
```

---

## 注意事项

1. **备份数据**：在执行任何迁移之前，务必备份数据库。

2. **检查依赖**：确保没有其他表或代码依赖要删除的枚举值。

3. **测试环境**：先在测试环境执行迁移，验证无误后再在生产环境执行。

4. **停机时间**：对于大型表，ALTER TABLE 可能需要较长时间，考虑在低峰期执行。

5. **事务处理**：如果可能，将迁移放在事务中执行，以便在出错时回滚。

6. **Prisma Client**：迁移后记得运行 `npx prisma generate` 更新 Prisma Client。

---

## 常见问题

### Q: Prisma migrate 自动生成的 SQL 不正确怎么办？

A: 使用 `--create-only` 参数创建迁移文件，然后手动编辑 SQL 语句。

### Q: 如何查看当前数据库中的 ENUM 定义？

A: 执行以下 SQL：

```sql
SHOW COLUMNS FROM `table_name` LIKE 'column_name';
```

### Q: 迁移失败怎么办？

A:

1. 检查错误信息
2. 如果迁移已部分执行，可能需要手动修复
3. 使用 `npx prisma migrate resolve` 标记迁移状态
4. 回滚到备份（如果有）

### Q: 可以一次性修改多个枚举类型吗？

A: 可以，但建议分别处理，以便更好地跟踪和回滚。

---

## 快速参考命令

```bash
# 创建迁移（不执行）
npx prisma migrate dev --name migration_name --create-only

# 创建并执行迁移
npx prisma migrate dev --name migration_name

# 标记迁移为已应用
npx prisma migrate resolve --applied migration_name

# 标记迁移为已回滚
npx prisma migrate resolve --rolled-back migration_name

# 生成 Prisma Client
npx prisma generate

# 查看迁移状态
npx prisma migrate status
```

# 管理员密码重置工具

当管理员忘记密码时，可以使用以下方法重置密码：

## 方法一：使用紧急重置API（推荐用于生产环境）

### 1. 设置环境变量

在 `.env` 文件中设置紧急重置密钥：

```env
EMERGENCY_RESET_SECRET_KEY=your-secret-key-here
```

**⚠️ 重要：生产环境必须设置一个强密钥！**

### 2. 调用API

使用 POST 请求调用紧急重置接口：

```bash
curl -X POST http://localhost:3000/api/admins/emergency-reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "secretKey": "your-secret-key-here"
  }'
```

或者使用 Postman 等工具：

- URL: `POST /api/admins/emergency-reset-password`
- Body:
  ```json
  {
    "username": "admin",
    "secretKey": "your-secret-key-here"
  }
  ```

### 3. 登录

重置成功后，使用以下凭据登录：

- 用户名：你提供的用户名
- 密码：`123456`

**⚠️ 登录后请立即修改密码！**

---

## 方法二：使用命令行脚本（推荐用于开发环境）

### 1. 运行脚本

```bash
# 在 lims-nest-server 目录下运行
npm run reset-admin-password <用户名>

# 或者直接使用 ts-node
npx ts-node scripts/reset-admin-password.ts <用户名>
```

### 2. 示例

```bash
# 重置用户名为 "admin" 的管理员密码
npm run reset-admin-password admin

# 或者
npx ts-node scripts/reset-admin-password.ts admin
```

### 3. 输出示例

```
正在查找管理员: admin...
✅ 找到管理员: ID=1, 用户名=admin, 角色=ADMIN

✅ 密码重置成功！
   用户名: admin
   新密码: 123456
   角色: ADMIN

⚠️  请立即登录系统并修改密码！
```

### 4. 登录

使用以下凭据登录：

- 用户名：你提供的用户名
- 密码：`123456`

**⚠️ 登录后请立即修改密码！**

---

## 方法三：通过其他管理员重置（如果还有其他管理员可以登录）

1. 使用其他管理员账号登录系统
2. 进入"我的"页面
3. 在用户管理中找到需要重置密码的管理员
4. 点击重置密码按钮
5. 密码将被重置为 `123456`

---

## 方法四：直接在数据库中重置（需要数据库访问权限）

如果以上方法都不可用，可以直接在数据库中重置：

```sql
-- 注意：密码需要使用 bcrypt 加密，这里只是示例
-- 实际使用时，需要先使用 bcrypt 加密 "123456"
UPDATE admins
SET password = '$2b$10$...' -- 这里是加密后的密码
WHERE username = 'admin';
```

**⚠️ 不推荐此方法，因为需要手动加密密码，容易出错。**

---

## 安全建议

1. **生产环境必须设置强密钥**：`EMERGENCY_RESET_SECRET_KEY` 应该是一个长且随机的字符串
2. **重置后立即修改密码**：所有重置方法都会将密码设置为 `123456`，这是默认密码，不安全
3. **限制紧急重置API的访问**：可以考虑在生产环境通过防火墙或反向代理限制此接口的访问
4. **记录重置操作**：建议在操作日志中记录所有密码重置操作

---

## 故障排除

### 问题：脚本找不到管理员

**原因**：用户名输入错误或管理员不存在

**解决**：检查用户名是否正确，可以使用以下SQL查询所有管理员：

```sql
SELECT id, username, role FROM admins;
```

### 问题：API返回密钥错误

**原因**：`secretKey` 参数与 `EMERGENCY_RESET_SECRET_KEY` 环境变量不匹配

**解决**：检查环境变量是否正确设置，确保API请求中的 `secretKey` 与 `.env` 文件中的值一致

### 问题：账户被锁定

**原因**：多次登录失败导致账户被锁定

**解决**：使用脚本重置密码时，脚本会自动解除锁定。如果使用API，需要等待锁定时间过期（15分钟）

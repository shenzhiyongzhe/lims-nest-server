const roleMap = {
  风控人: 'risk_controller',
  负责人: 'collector',
  收款人: 'payee',
  打款人: 'lender',
  财务员: 'financial',
  管理员: 'admin',
};
const transformRoleType = (roleType: string) => {
  if (!roleMap[roleType]) {
    return roleType;
  }
  return roleMap[roleType];
};

export { transformRoleType };

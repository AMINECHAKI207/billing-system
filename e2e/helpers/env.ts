export const e2eEnv = {
  baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5174',
  apiURL: process.env.E2E_API_URL || 'http://127.0.0.1:5100',
  password: process.env.E2E_PASSWORD || 'E2ePassword123!',
  adminEmail: process.env.E2E_ADMIN_EMAIL || 'e2e.admin@billingsystem.test',
  employeeAllEmail: process.env.E2E_EMPLOYEE_ALL_EMAIL || 'e2e.employee.all@billingsystem.test',
  employeeOwnEmail: process.env.E2E_EMPLOYEE_OWN_EMAIL || 'e2e.employee.own@billingsystem.test',
  employeeSelectedEmail: process.env.E2E_EMPLOYEE_SELECTED_EMAIL || 'e2e.employee.selected@billingsystem.test',
  restrictedEmail: process.env.E2E_RESTRICTED_EMAIL || 'e2e.restricted@billingsystem.test',
};

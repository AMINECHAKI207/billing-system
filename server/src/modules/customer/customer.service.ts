import { ApiError } from '@utils/ApiError';
import { customerRepository } from './customer.repository';
import { CreateCustomerInput, CustomerQueryInput, UpdateCustomerInput } from './customer.schema';
import { parsePagination, parseSort } from '@utils/pagination';
import { PermissionScope } from '@prisma/client';
import { customerAccessWhere } from '@modules/rbac/accessScope';
import { getCountryName, isValidCountryCode, normalizeCountryCode } from '@utils/countries';

export class CustomerService {
  /**
   * Create a new customer
   */
  async createCustomer(userId: string, data: CreateCustomerInput) {
    // Check if email already exists
    const existing = await customerRepository.findByEmail(data.email);
    if (existing) {
      throw ApiError.conflict('Customer with this email already exists');
    }

    const country = this.normalizeCustomerCountry(data.country, data.countryCode);

    return customerRepository.create({
      ...data,
      ...country,
      createdById: userId,
    });
  }

  /**
   * Get a paginated list of customers
   */
  async getCustomers(userId: string, scope: PermissionScope, query: CustomerQueryInput) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });
    const { sortBy, sortOrder } = parseSort(
      { sortBy: query.sortBy, sortOrder: query.sortOrder },
      ['createdAt', 'name', 'company', 'email'],
      'createdAt'
    );
    
    const { data, total } = await customerRepository.findAll({
      skip,
      take: limit,
      search: query.search,
      isActive: query.isActive,
      orderBy: { [sortBy]: sortOrder },
      accessWhere: customerAccessWhere(userId, scope),
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single customer by ID
   */
  async getCustomerById(id: string, userId: string, scope: PermissionScope) {
    const customer = await customerRepository.findById(id, customerAccessWhere(userId, scope));
    if (!customer) {
      throw ApiError.notFound('Customer not found');
    }

    const financialSummary = await customerRepository.getFinancialSummary(id);

    return {
      ...customer,
      financialSummary,
    };
  }

  /**
   * Update a customer
   */
  async updateCustomer(id: string, userId: string, scope: PermissionScope, data: UpdateCustomerInput) {
    const customer = await customerRepository.findById(id, customerAccessWhere(userId, scope));
    if (!customer) {
      throw ApiError.notFound('Customer not found');
    }

    // If updating email, ensure it doesn't conflict with another customer
    if (data.email && data.email !== customer.email) {
      const existing = await customerRepository.findByEmail(data.email);
      if (existing) {
        throw ApiError.conflict('Email is already in use by another customer');
      }
    }

    const country =
      data.country !== undefined || data.countryCode !== undefined
        ? this.normalizeCustomerCountry(
            data.country ?? customer.country,
            data.countryCode ?? customer.countryCode
          )
        : {};

    return customerRepository.update(id, { ...data, ...country });
  }

  /**
   * Delete a customer (soft delete or hard delete)
   * We will do a hard delete for simplicity, but in a real app,
   * you might just set isActive = false.
   */
  async deleteCustomer(id: string, userId: string, scope: PermissionScope) {
    const customer = await customerRepository.findById(id, customerAccessWhere(userId, scope));
    if (!customer) {
      throw ApiError.notFound('Customer not found');
    }

    // In a real application, you might want to prevent deletion if they have invoices
    // but our DB schema has restrict/cascade rules.
    // For Customer -> Invoices, it is Restrict, so Prisma will throw an error
    // if we try to delete a customer with invoices.
    try {
      await customerRepository.delete(id);
    } catch (error: any) {
      if (error.code === 'P2003') { // Foreign key constraint failed
        throw ApiError.badRequest('Cannot delete customer with existing invoices. Deactivate them instead.');
      }
      throw error;
    }

    return true;
  }

  private normalizeCustomerCountry(country?: string | null, countryCode?: string | null) {
    if (!country?.trim() || !countryCode?.trim()) {
      throw ApiError.badRequest("Please select the customer's country.");
    }

    const normalizedCode = normalizeCountryCode(countryCode);
    if (!isValidCountryCode(normalizedCode)) {
      throw ApiError.badRequest("Please select the customer's country.");
    }

    return {
      country: country.trim() || getCountryName(normalizedCode),
      countryCode: normalizedCode,
    };
  }
}

export const customerService = new CustomerService();

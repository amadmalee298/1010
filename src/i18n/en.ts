import type { Dictionary } from './th';

export const en: Dictionary = {
  app: { name: 'Custard POS', tagline: 'Dessert shop POS & management' },
  common: {
    save: 'Save', cancel: 'Cancel', close: 'Close', edit: 'Edit', add: 'Add', delete: 'Delete', search: 'Search',
    confirm: 'Confirm', back: 'Back', loading: 'Loading…', noData: 'No data', active: 'Active', inactive: 'Inactive',
    status: 'Status', note: 'Note', name: 'Name', total: 'Total', actions: 'Actions', all: 'All', yes: 'Yes', no: 'No',
    from: 'From', to: 'To', date: 'Date', quantity: 'Quantity', price: 'Price', cost: 'Cost', unit: 'Unit',
    saved: 'Saved', error: 'Error', required: 'Required', optional: 'Optional', print: 'Print',
    export: 'Export', today: 'Today', details: 'Details', reason: 'Reason', type: 'Type', create: 'Create',
  },
  nav: {
    pos: 'POS', orders: 'Orders', kitchen: 'Kitchen', dashboard: 'Dashboard', products: 'Products', categories: 'Categories',
    ingredients: 'Ingredients', recipes: 'Recipes', inventory: 'Inventory', production: 'Production', suppliers: 'Suppliers',
    purchasing: 'Purchasing', customers: 'Customers', promotions: 'Promotions', expenses: 'Expenses', cash: 'Cash drawer',
    reports: 'Reports', employees: 'Employees', audit: 'Audit log', settings: 'Settings', signOut: 'Sign out',
    groupSales: 'Sales', groupStock: 'Stock & production', groupFinance: 'Finance', groupAdmin: 'Admin',
  },
  auth: {
    title: 'Sign in', email: 'Email', password: 'Password', submit: 'Sign in',
    invalid: 'Invalid email or password', notEmployee: 'This account is not an active employee',
    forbidden: 'You do not have access to this page', configError: 'Supabase connection is not configured',
  },
  roles: { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier', KITCHEN: 'Kitchen' },
  errors: {
    generic: 'Something went wrong, please try again', permission: 'You are not allowed to do this', validation: 'Invalid data',
    insufficientStock: 'Insufficient stock', notFound: 'Not found', duplicate: 'Already exists',
    noOpenSession: 'Open the cash drawer first', offline: 'You are offline — this action needs a connection',
  },
};

import { redirect } from 'next/navigation';
import { AuthUnavailableError, getCurrentEmployee } from '@/server/auth';
import { homePathFor } from '@/domain/permissions';

export default async function Home() {
  let employee;
  try {
    employee = await getCurrentEmployee();
  } catch (err) {
    if (err instanceof AuthUnavailableError) redirect('/unavailable');
    throw err;
  }
  redirect(employee ? homePathFor(employee.role) : '/login');
}

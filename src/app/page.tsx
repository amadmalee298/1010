import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/server/auth';
import { homePathFor } from '@/domain/permissions';

export default async function Home() {
  const employee = await getCurrentEmployee();
  redirect(employee ? homePathFor(employee.role) : '/login');
}

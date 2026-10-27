import Link from 'next/link';

export const dynamic = 'force-static';

/** Shown when the database does not answer in time (e.g. the Supabase project is paused). */
export default function UnavailablePage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid max-w-md gap-3">
        <div className="text-5xl" aria-hidden>🛠️</div>
        <h1 className="text-xl font-semibold">ฐานข้อมูลไม่ตอบสนอง</h1>
        <p className="text-muted-foreground">
          ระบบติดต่อฐานข้อมูล (Supabase) ไม่ได้ในขณะนี้ ถ้าใช้แพ็กเกจฟรีและไม่ได้ใช้งานเกิน 7 วัน
          Supabase จะหยุดโปรเจกต์ชั่วคราว
        </p>
        <p className="text-sm text-muted-foreground">
          เจ้าของร้าน: เปิด supabase.com → เลือกโปรเจกต์ → กด &quot;Restore project&quot; แล้วรอ 2–3 นาที จากนั้นกดลองใหม่
        </p>
        <p><Link href="/" prefetch={false} className="font-medium underline">ลองใหม่</Link></p>
      </div>
    </main>
  );
}

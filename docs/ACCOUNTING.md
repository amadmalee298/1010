# Accounting (บัญชีและงบการเงิน)

The app keeps a **double-entry general ledger** (`gl_lines`, a database view) that is
derived from the operational records, so every sale, refund, expense, stock movement,
cash-drawer movement and approved bill is already "posted" — including history from
before this feature existed. The owner adds what operations cannot know (opening
balances, equipment, loans, capital, drawings, depreciation) as **manual journals**.

Menu: **บัญชีและงบการเงิน** (`/accounting`, owner and manager; posting journals is owner-only).

## Statements

| Tab | Function | Notes |
|---|---|---|
| งบกำไรขาดทุน | `report_gl_pnl(from, to)` | Revenue − COGS − other costs − operating expenses (by category) |
| งบดุล | `report_balance_sheet(as_of)` | Assets = liabilities + equity + earnings to date; shows "งบดุลลงตัว ✓" |
| งบกระแสเงินสด | `report_cash_flow(from, to)` | Direct method over cash accounts 1000/1001/1010: customers, suppliers, expenses, other, investing, financing |
| สมุดรายวัน | `post_journal`, `reverse_journal` | Append-only; mistakes are fixed with a reversing entry |
| งบทดลอง | `report_trial_balance(as_of)` | Debit/credit/balance per account |

## Chart of accounts

| Code | Account | Code | Account |
|---|---|---|---|
| 1000 | เงินสดในลิ้นชัก | 2000 | เจ้าหนี้การค้า |
| 1001 | เงินสดนอกลิ้นชัก / เงินสดย่อย | 2100 | เงินกู้ยืม |
| 1010 | เงินฝากธนาคาร / พร้อมเพย์ | 2200 | ภาษีขาย |
| 1190 | เงินรอตัดบัญชี (system) | 2300 | ภาษีหัก ณ ที่จ่ายค้างจ่าย |
| 1200 | สินค้าคงเหลือ | 2400 | ค่าใช้จ่ายค้างจ่าย |
| 1300 | ภาษีซื้อ | 3000 | ทุน |
| 1400 | เงินมัดจำและลูกหนี้อื่น | 3100 | ปรับปรุงสินค้ายกมา |
| 1500 | อุปกรณ์และสินทรัพย์ถาวร | 3200 | ถอนใช้ส่วนตัว |
| 1510 | ค่าเสื่อมราคาสะสม | 3300 | กำไรสะสมยกมา |
| 4000 | รายได้จากการขาย | 5000 | ต้นทุนขาย |
| 4010 | รับคืนสินค้า / คืนเงิน | 5300 / 5310 / 5320 | สต็อกขาด / ของเสีย / ผลต่างการผลิต |
| 4900 | รายได้อื่น / เงินสดเกิน | 5900 | เงินสดขาด |
| 6000 | ค่าใช้จ่ายดำเนินงาน (by category) | 6100 / 6900 | ค่าเสื่อมราคา / ค่าใช้จ่ายอื่น |

## Automatic postings

| Source | Debit | Credit |
|---|---|---|
| Sale (order, not cancelled) | 1190 total | 4000 total − VAT, 2200 VAT |
| Non-cash payment (QR / transfer / card) | 1010 | 1190 |
| Cash into / out of the drawer (cash ledger) | 1000 ↔ 1190 | (opening float and manual withdrawals/deposits ↔ 1001) |
| Refund | 4010 (ex VAT), 2200 VAT | 1190; non-drawer refunds then 1190 / 1010 or 1001 |
| Stock sold / returned | 5000 / 1200 | 1200 / 5000 |
| Purchase (PO receipt, approved bill) | 1200 | 1190 if paid from the drawer, otherwise 1010 (bills: 1001 when paid cash outside the drawer) |
| Waste / negative adjustment / production | 5310 / 5300 / 5320 | 1200 (production: both legs on 1200 via 5320) |
| Positive stock adjustment | 1200 | 3100 (opening stock, matching `report_pnl`) |
| Expense (and void, reversed on the void date) | 6000 | 1190 drawer / 1001 cash / 1010 other |
| Drawer close | 1001 counted cash; 1000 or 5900 for over/short | 1000; 4900 when over |

1190 must net to zero; the balance sheet warns when it does not.

## Getting started
1. **สมุดรายวัน → บันทึกยอดยกมา**: enter the bank balance, cash in the safe, equipment, loans, and put the
   balancing amount in 3000 ทุน; tick *ยอดยกมา*. Date it the day before the first sale in the system.
2. Opening stock entered through *สต็อก → ปรับยอด* already posts to 3100.
3. Record later equipment purchases, loans and drawings as journals.

## E-signatures
Each employee draws a signature once (**ลายเซ็นของฉัน**). When a no-receipt bill is approved, the submitter's
signature (ผู้เบิกจ่าย) and the approver's signature and name (ผู้อนุมัติ) are copied onto the bill, so the
issued ใบรับรองแทนใบเสร็จรับเงิน never changes afterwards.

## Not yet included (next phases)
* VAT: input/output VAT reports and ภ.พ.30 (to be enabled when the company registers for VAT)
* Withholding tax with 50 ทวิ certificates, ภ.ง.ด.3 / ภ.ง.ด.53
* Payroll, social security, ภ.ง.ด.1 and payslips

These statements are management accounts; have an accountant review them before filing.

import * as React from 'react'
import { Download, FileSpreadsheet, FileText, Printer, Table2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MonthlyReport } from '@/lib/report'
import {
  downloadMonthlyCsv,
  downloadMonthlyPdf,
  downloadMonthlyXlsx,
} from '@/lib/export'
import { useClock } from '@/providers/clock-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Report export.
 *
 * The generation timestamp comes from the trusted clock, so a report produced on
 * a phone with a wrong clock is still stamped correctly. The PDF path is async
 * because jspdf is code-split; the menu item shows a spinner while it loads.
 */
export function ExportMenu({ report }: { report: MonthlyReport }) {
  const { now } = useClock()
  const [busy, setBusy] = React.useState(false)

  const run = async (label: string, action: () => void | Promise<void>) => {
    setBusy(true)
    try {
      await action()
      toast.success(`${label} downloaded`, {
        description: `${report.label} attendance report.`,
      })
    } catch (error) {
      toast.error(`The ${label} could not be generated`, {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" loading={busy} loadingText="Preparing…">
          <Download aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{report.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => void run('PDF', () => downloadMonthlyPdf(report, now))}
        >
          <FileText aria-hidden="true" />
          <span className="flex-1">Download PDF</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={() => void run('spreadsheet', () => downloadMonthlyXlsx(report, now))}
        >
          <FileSpreadsheet aria-hidden="true" />
          <span className="flex-1">Download Excel (.xlsx)</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={() => void run('CSV', () => downloadMonthlyCsv(report, now))}
        >
          <Table2 aria-hidden="true" />
          <span className="flex-1">Download CSV</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => window.print()}>
          <Printer aria-hidden="true" />
          <span className="flex-1">Print report</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface AdminReportSummaryEntry {
  name: string;
  loanAmount: number;
  companyCost: number;
  pendingPrincipal: number;
  totalReceived: number;
  receivedPrincipal: number;
  receivedInterest: number;
  commission: number;
  withholding: number;
}

export interface AdminReportDetailRow {
  userName: string;
  status: string;
  date: Date | null;
  applyTimes: number;
  loanAmount: number;
  totalReceived: number;
  receivedPrincipal: number;
  receivedInterest: number;
  outstandingPrincipal: number;
  ratio: number;
  commission: number;
  handlingRate: number;
  handlingFee: number;
  profit: number;
  collectorName: string;
  riskControllerName: string;
  repaymentSchedules: Array<{
    dueDate: Date;
    principal: number;
    interest: number;
  }>;
}

export interface AdminReportGroupedDetails {
  name: string;
  rows: AdminReportDetailRow[];
}

export interface AdminReportWorkbookData {
  collectorsSummary: AdminReportSummaryEntry[];
  riskControllersSummary: AdminReportSummaryEntry[];
  collectorDetails: AdminReportGroupedDetails[];
  riskControllerDetails: AdminReportGroupedDetails[];
  generatedAt: Date;
}

@Injectable()
export class ExcelExportService {
  async generateAdminReport(data: AdminReportWorkbookData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LIMS';
    workbook.created = data.generatedAt;

    this.buildSummarySheet(
      workbook,
      data.collectorsSummary,
      data.riskControllersSummary,
    );
    this.buildDetailSheets(workbook, data.collectorDetails, '负责人');
    this.buildDetailSheets(workbook, data.riskControllerDetails, '风控');

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return buffer;
  }

  private buildSummarySheet(
    workbook: ExcelJS.Workbook,
    collectors: AdminReportSummaryEntry[],
    riskControllers: AdminReportSummaryEntry[],
  ) {
    const sheet = workbook.addWorksheet('总表', {
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    sheet.columns = [
      { header: '角色', key: 'name', width: 20 },
      {
        header: '总计借出',
        key: 'loanAmount',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: '实际成本',
        key: 'companyCost',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: '待收本金',
        key: 'pendingPrincipal',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: '本利收回',
        key: 'totalReceived',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: '收回本金',
        key: 'receivedPrincipal',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: '收回利息',
        key: 'receivedInterest',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: '总计回佣',
        key: 'commission',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: '总计后扣',
        key: 'withholding',
        width: 18,
        style: { numFmt: '#,##0.00' },
      },
    ];

    let currentRow = 1;
    currentRow = this.appendSummarySection(
      sheet,
      currentRow,
      '负责人汇总',
      collectors,
    );
    currentRow = this.appendSummarySection(
      sheet,
      currentRow + 1,
      '风控人汇总',
      riskControllers,
    );
  }

  private appendSummarySection(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    title: string,
    entries: AdminReportSummaryEntry[],
  ): number {
    const titleRow = sheet.getRow(startRow);
    titleRow.getCell(1).value = title;
    titleRow.font = { bold: true };
    sheet.mergeCells(startRow, 1, startRow, sheet.columnCount);

    const headerRow = sheet.getRow(startRow + 1);
    headerRow.values = sheet.columns.map((col) => {
      const header = col.header;
      return Array.isArray(header) ? header.join(' / ') : (header ?? '');
    });
    headerRow.font = { bold: true };

    let rowPointer = startRow + 2;
    entries.forEach((entry) => {
      const row = sheet.getRow(rowPointer);
      row.values = [
        entry.name,
        entry.loanAmount,
        entry.companyCost,
        entry.pendingPrincipal,
        entry.totalReceived,
        entry.receivedPrincipal,
        entry.receivedInterest,
        entry.commission,
        entry.withholding,
      ];
      rowPointer += 1;
    });

    if (entries.length > 0) {
      const totals = entries.reduce(
        (acc, entry) => ({
          loanAmount: acc.loanAmount + entry.loanAmount,
          companyCost: acc.companyCost + entry.companyCost,
          pendingPrincipal: acc.pendingPrincipal + entry.pendingPrincipal,
          totalReceived: acc.totalReceived + entry.totalReceived,
          receivedPrincipal: acc.receivedPrincipal + entry.receivedPrincipal,
          receivedInterest: acc.receivedInterest + entry.receivedInterest,
          commission: acc.commission + entry.commission,
          withholding: acc.withholding + entry.withholding,
        }),
        {
          loanAmount: 0,
          companyCost: 0,
          pendingPrincipal: 0,
          totalReceived: 0,
          receivedPrincipal: 0,
          receivedInterest: 0,
          commission: 0,
          withholding: 0,
        },
      );

      const totalRow = sheet.getRow(rowPointer);
      totalRow.values = [
        '总计',
        totals.loanAmount,
        totals.companyCost,
        totals.pendingPrincipal,
        totals.totalReceived,
        totals.receivedPrincipal,
        totals.receivedInterest,
        totals.commission,
        totals.withholding,
      ];
      totalRow.font = { bold: true };
      rowPointer += 1;
    }

    return rowPointer;
  }

  private buildDetailSheets(
    workbook: ExcelJS.Workbook,
    groups: AdminReportGroupedDetails[],
    prefix: string,
  ) {
    const usedNames = new Map<string, number>();
    const baseHeaders = [
      '序号',
      '姓名',
      '状态',
      '日期',
      '次数',
      '放出',
      '总收回',
      '收回本金',
      '收回利息',
      '未收本金',
      '成数',
      '回佣',
      '后扣',
      '后扣费用',
      '盈亏',
      '风控人',
      '负责人',
    ];
    const baseColumnConfigs: Partial<ExcelJS.Column>[] = [
      { header: baseHeaders[0], key: 'seq', width: 6 },
      { header: baseHeaders[1], key: 'userName', width: 16 },
      { header: baseHeaders[2], key: 'status', width: 12 },
      { header: baseHeaders[3], key: 'date', width: 14 },
      { header: baseHeaders[4], key: 'applyTimes', width: 8 },
      {
        header: baseHeaders[5],
        key: 'loanAmount',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: baseHeaders[6],
        key: 'totalReceived',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: baseHeaders[7],
        key: 'receivedPrincipal',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: baseHeaders[8],
        key: 'receivedInterest',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: baseHeaders[9],
        key: 'outstandingPrincipal',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: baseHeaders[10],
        key: 'ratio',
        width: 10,
        style: { numFmt: '0.00%' },
      },
      {
        header: baseHeaders[11],
        key: 'commission',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: baseHeaders[12],
        key: 'handlingRate',
        width: 10,
        style: { numFmt: '0.00%' },
      },
      {
        header: baseHeaders[13],
        key: 'handlingFee',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      {
        header: baseHeaders[14],
        key: 'profit',
        width: 14,
        style: { numFmt: '#,##0.00' },
      },
      { header: baseHeaders[15], key: 'riskControllerName', width: 16 },
      { header: baseHeaders[16], key: 'collectorName', width: 16 },
    ];
    const baseColumnCount = baseColumnConfigs.length;

    groups.forEach((group) => {
      const sanitizedName = this.ensureUniqueSheetName(
        workbook,
        `${prefix}-${group.name || '未分配'}`,
        usedNames,
      );
      const sheet = workbook.addWorksheet(sanitizedName, {
        views: [{ state: 'frozen', ySplit: 2 }],
      });
      sheet.columns = baseColumnConfigs;

      const dateInfos = this.collectScheduleDates(group.rows);
      dateInfos.forEach((info, idx) => {
        const columnIndex = baseColumnCount + idx + 1;
        const column = sheet.getColumn(columnIndex);
        column.width = 12;
        column.style = { numFmt: '#,##0.00' };
      });

      const headerRowTop = sheet.getRow(1);
      const headerRowBottom = sheet.getRow(2);

      for (let i = 0; i < baseColumnCount; i += 1) {
        const columnIndex = i + 1;
        headerRowTop.getCell(columnIndex).value = baseHeaders[i];
        headerRowTop.getCell(columnIndex).font = { bold: true };
        headerRowTop.getCell(columnIndex).alignment = {
          vertical: 'middle',
          horizontal: 'center',
        };
        sheet.mergeCells(1, columnIndex, 2, columnIndex);
      }

      dateInfos.forEach((info, idx) => {
        const columnIndex = baseColumnCount + idx + 1;
        headerRowTop.getCell(columnIndex).value = info.displayLabel;
        headerRowTop.getCell(columnIndex).font = { bold: true };
        headerRowTop.getCell(columnIndex).alignment = { horizontal: 'center' };
        headerRowBottom.getCell(columnIndex).value = '本金/利息';
        headerRowBottom.getCell(columnIndex).font = { bold: true };
        headerRowBottom.getCell(columnIndex).alignment = {
          horizontal: 'center',
        };
      });

      const totals = {
        applyTimes: 0,
        loanAmount: 0,
        totalReceived: 0,
        receivedPrincipal: 0,
        receivedInterest: 0,
        outstandingPrincipal: 0,
        commission: 0,
        handlingFee: 0,
        profit: 0,
      };
      const dateTotals = new Map<
        string,
        { principal: number; interest: number }
      >();
      dateInfos.forEach((info) => {
        dateTotals.set(info.key, { principal: 0, interest: 0 });
      });

      let currentRow = 3;
      group.rows.forEach((row, index) => {
        const principalInterestByDate = new Map<
          string,
          { principal: number; interest: number }
        >();
        row.repaymentSchedules.forEach((schedule) => {
          const key = this.formatScheduleKey(schedule.dueDate);
          principalInterestByDate.set(key, {
            principal: schedule.principal,
            interest: schedule.interest,
          });
        });

        const baseValues: (string | number | Date | null)[] = [
          index + 1,
          row.userName,
          row.status,
          row.date ? this.formatDate(row.date) : '',
          row.applyTimes,
          row.loanAmount,
          row.totalReceived,
          row.receivedPrincipal,
          row.receivedInterest,
          row.outstandingPrincipal,
          row.ratio,
          row.commission,
          row.handlingRate,
          row.handlingFee,
          row.profit,
          row.riskControllerName,
          row.collectorName,
        ];

        for (let i = 0; i < baseColumnCount; i += 1) {
          const columnIndex = i + 1;
          sheet.mergeCells(
            currentRow,
            columnIndex,
            currentRow + 1,
            columnIndex,
          );
          const cell = sheet.getCell(currentRow, columnIndex);
          cell.value = baseValues[i];
          cell.alignment = {
            vertical: 'middle',
            horizontal: i === 0 ? 'center' : undefined,
          };
        }

        dateInfos.forEach((info, idx) => {
          const columnIndex = baseColumnCount + idx + 1;
          const schedule = principalInterestByDate.get(info.key);
          const topCell = sheet.getCell(currentRow, columnIndex);
          const bottomCell = sheet.getCell(currentRow + 1, columnIndex);
          topCell.value =
            schedule && schedule.principal !== undefined
              ? schedule.principal
              : '';
          bottomCell.value =
            schedule && schedule.interest !== undefined
              ? schedule.interest
              : '';
          if (schedule) {
            const totalsByDate = dateTotals.get(info.key);
            if (totalsByDate) {
              totalsByDate.principal += schedule.principal ?? 0;
              totalsByDate.interest += schedule.interest ?? 0;
            }
          }
        });

        totals.applyTimes += row.applyTimes;
        totals.loanAmount += row.loanAmount;
        totals.totalReceived += row.totalReceived;
        totals.receivedPrincipal += row.receivedPrincipal;
        totals.receivedInterest += row.receivedInterest;
        totals.outstandingPrincipal += row.outstandingPrincipal;
        totals.commission += row.commission;
        totals.handlingFee += row.handlingFee;
        totals.profit += row.profit;

        currentRow += 2;
      });

      const summaryRowTopIndex = currentRow;
      const summaryRowBottomIndex = currentRow + 1;
      const summaryValues: (string | number)[] = [
        '合计',
        '',
        '',
        '',
        totals.applyTimes,
        totals.loanAmount,
        totals.totalReceived,
        totals.receivedPrincipal,
        totals.receivedInterest,
        totals.outstandingPrincipal,
        '',
        totals.commission,
        '',
        totals.handlingFee,
        totals.profit,
        '',
        '',
      ];

      for (let i = 0; i < baseColumnCount; i += 1) {
        const columnIndex = i + 1;
        sheet.mergeCells(
          summaryRowTopIndex,
          columnIndex,
          summaryRowBottomIndex,
          columnIndex,
        );
        const cell = sheet.getCell(summaryRowTopIndex, columnIndex);
        cell.value = summaryValues[i];
        cell.font = { bold: true };
        cell.alignment = {
          vertical: 'middle',
          horizontal: i === 0 ? 'center' : undefined,
        };
      }

      dateInfos.forEach((info, idx) => {
        const columnIndex = baseColumnCount + idx + 1;
        const totalsByDate = dateTotals.get(info.key);
        const principalTotal = totalsByDate ? totalsByDate.principal : 0;
        const interestTotal = totalsByDate ? totalsByDate.interest : 0;
        const topCell = sheet.getCell(summaryRowTopIndex, columnIndex);
        const bottomCell = sheet.getCell(summaryRowBottomIndex, columnIndex);
        topCell.value = principalTotal;
        bottomCell.value = interestTotal;
        topCell.font = { bold: true };
        bottomCell.font = { bold: true };
        topCell.alignment = { horizontal: 'center' };
        bottomCell.alignment = { horizontal: 'center' };
      });
    });
  }

  private ensureUniqueSheetName(
    workbook: ExcelJS.Workbook,
    desiredName: string,
    usedNames: Map<string, number>,
  ): string {
    const sanitized = this.sanitizeSheetName(desiredName);
    const existingCount = usedNames.get(sanitized) ?? 0;

    if (existingCount === 0 && !workbook.getWorksheet(sanitized)) {
      usedNames.set(sanitized, 1);
      return sanitized;
    }

    let suffix = existingCount;
    let candidate = sanitized;
    while (workbook.getWorksheet(candidate)) {
      suffix += 1;
      candidate = this.cutSheetName(`${sanitized}-${suffix}`);
    }
    usedNames.set(sanitized, suffix);
    return candidate;
  }

  private sanitizeSheetName(name: string): string {
    const sanitized = name.replace(/[\\/*?:[\]]/g, '_').trim() || 'Sheet';
    return this.cutSheetName(sanitized);
  }

  private cutSheetName(name: string): string {
    return name.length > 31 ? name.slice(0, 31) : name;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private collectScheduleDates(rows: AdminReportDetailRow[]) {
    const dates = new Map<
      string,
      { sortValue: number; displayLabel: string }
    >();
    rows.forEach((row) => {
      row.repaymentSchedules.forEach((schedule) => {
        const key = this.formatScheduleKey(schedule.dueDate);
        if (!dates.has(key)) {
          dates.set(key, {
            sortValue: schedule.dueDate.getTime(),
            displayLabel: this.formatScheduleDisplay(schedule.dueDate),
          });
        }
      });
    });

    return Array.from(dates.entries())
      .sort((a, b) => a[1].sortValue - b[1].sortValue)
      .map(([key, value]) => ({ key, displayLabel: value.displayLabel }));
  }

  private formatScheduleKey(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatScheduleDisplay(date: Date): string {
    const month = date.getMonth() + 1;
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${month}.${day}`;
  }
}

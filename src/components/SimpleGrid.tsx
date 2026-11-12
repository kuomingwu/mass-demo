import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  makeStyles,
  tokens,
  type DataGridProps,
  type TableColumnDefinition,
  type TableColumnSizingOptions,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  wrap: {
    overflowX: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  clickable: { cursor: 'pointer' },
});

interface Props<T> {
  items: T[];
  columns: TableColumnDefinition<T>[];
  getRowId: (item: T) => string;
  ariaLabel: string;
  onRowClick?: (item: T) => void;
  columnSizing?: TableColumnSizingOptions;
  minWidth?: number;
  sortable?: boolean;
}

/** Fluent DataGrid 包裝：語意化表格、鍵盤可操作、可選的列點擊 */
export function SimpleGrid<T>({ items, columns, getRowId, ariaLabel, onRowClick, columnSizing, minWidth = 900, sortable = true }: Props<T>) {
  const s = useStyles();
  const gridProps: Partial<DataGridProps> = {};
  return (
    <div className={s.wrap}>
      <DataGrid
        items={items}
        columns={columns}
        getRowId={getRowId}
        sortable={sortable}
        resizableColumns
        columnSizingOptions={columnSizing}
        focusMode="composite"
        aria-label={ariaLabel}
        style={{ minWidth }}
        {...gridProps}
      >
        <DataGridHeader>
          <DataGridRow>{({ renderHeaderCell }) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}</DataGridRow>
        </DataGridHeader>
        <DataGridBody<T>>
          {({ item, rowId }) => (
            <DataGridRow<T>
              key={rowId}
              className={onRowClick ? s.clickable : undefined}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              onKeyDown={
                onRowClick
                  ? (e: React.KeyboardEvent<HTMLElement>) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(item);
                    }
                  : undefined
              }
            >
              {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
    </div>
  );
}

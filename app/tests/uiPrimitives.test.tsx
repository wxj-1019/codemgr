import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';
import { IconButton } from '../src/components/ui/IconButton';
import { PanelActionBar } from '../src/components/ui/PanelActionBar';
import { PanelAlert } from '../src/components/ui/PanelAlert';
import { StateView } from '../src/components/ui/StateView';
import { getProcessKindTone } from '../src/lib/kindStyles';

describe('Button', () => {
  it.each(['primary', 'secondary', 'ghost', 'dangerQuiet'] as const)(
    'renders the %s variant and forwards button props',
    (variant) => {
      const onClick = vi.fn();
      render(
        <Button variant={variant} size="sm" type="submit" onClick={onClick}>
          Run
        </Button>,
      );

      const button = screen.getByRole('button', { name: 'Run' });
      expect(button).toHaveAttribute('data-variant', variant);
      expect(button).toHaveAttribute('data-size', 'sm');
      expect(button).toHaveAttribute('type', 'submit');
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledOnce();
    },
  );

  it.each(['xs', 'sm', 'md'] as const)('supports the %s size', (size) => {
    render(<Button size={size}>{size}</Button>);
    expect(screen.getByRole('button', { name: size })).toHaveAttribute('data-size', size);
  });

  it('disables interaction and exposes busy state without removing the original label', () => {
    const onClick = vi.fn();
    render(
      <Button busy busyLabel="Starting" onClick={onClick}>
        Start service
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Starting' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Start service');
    expect(button).toHaveTextContent('Starting');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses a grid overlay so a long busy label participates in intrinsic width', () => {
    render(
      <Button busy busyLabel="Starting every development service">
        Start
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Starting every development service' });
    expect(button).toHaveClass('grid');
    expect(button).not.toHaveClass('relative');
    expect(screen.getByText('Start')).toHaveClass('col-start-1', 'row-start-1');
    expect(screen.getByText('Starting every development service').parentElement).toHaveClass(
      'col-start-1',
      'row-start-1',
    );
  });
});

describe('IconButton', () => {
  it('uses its label for both accessible name and native tooltip', () => {
    render(
      <IconButton label="Refresh data">
        <svg data-testid="refresh-icon" />
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Refresh data' });
    expect(button).toHaveAttribute('aria-label', 'Refresh data');
    expect(button).toHaveAttribute('title', 'Refresh data');
    expect(screen.getByTestId('refresh-icon')).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it.each(['neutral', 'success', 'info', 'warning', 'danger', 'accent'] as const)(
    'renders the %s semantic tone',
    (tone) => {
      render(<Badge tone={tone}>{tone}</Badge>);
      expect(screen.getByText(tone)).toHaveAttribute('data-tone', tone);
    },
  );
});

describe('StateView', () => {
  it.each([
    ['loading', 'Loading projects', 'status'],
    ['empty', 'No projects', 'status'],
    ['error', 'Could not load projects', 'alert'],
  ] as const)('renders the %s state with the correct live-region role', (state, title, role) => {
    render(<StateView state={state} title={title} description="Details" />);

    expect(screen.getByRole(role)).toHaveAttribute('data-state', state);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });

  it('renders an optional action', () => {
    render(
      <StateView
        state="empty"
        title="Nothing here"
        action={<Button>Try again</Button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps state live-region semantics under component control', () => {
    const consumerProps = { role: 'presentation', 'aria-live': 'off' } as const;
    render(
      <StateView {...consumerProps} state="error" title="Failed" />,
    );

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('panel feedback primitives', () => {
  it('exposes structured panel context and actions as a narrow-safe named toolbar', () => {
    render(
      <PanelActionBar
        label="Process actions"
        eyebrow="Live"
        heading="Processes"
        summary="12 running"
        leading={<Badge tone="success">Healthy</Badge>}
        actions={<Button>Stop</Button>}
        secondaryActions={<Button variant="ghost">Refresh</Button>}
      />,
    );

    const toolbar = screen.getByRole('toolbar', { name: 'Process actions' });
    expect(toolbar).toHaveAttribute('data-testid', 'panel-action-bar');
    expect(toolbar).toHaveClass('panel-action-bar', 'flex-wrap');
    expect(toolbar.querySelector('[data-panel-context]')).toHaveClass('min-w-0', 'flex-1');
    expect(toolbar.querySelector('[data-panel-actions]')).toHaveClass('min-w-0', 'flex-wrap');
    expect(toolbar).toHaveTextContent('Live');
    expect(toolbar).toHaveTextContent('Processes');
    expect(toolbar).toHaveTextContent('12 running');
    expect(toolbar).toContainElement(screen.getByText('Healthy'));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Stop' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Refresh' }));
  });

  it('keeps optional structured action-bar regions absent when unused', () => {
    render(<PanelActionBar label="Empty actions" />);
    const toolbar = screen.getByRole('toolbar', { name: 'Empty actions' });
    expect(toolbar).toHaveAttribute('data-testid', 'panel-action-bar');
    expect(toolbar.textContent?.trim()).toBe('');
  });

  it('uses assertive alerts for danger and polite status semantics otherwise', () => {
    const { rerender } = render(<PanelAlert tone="danger">Process stopped</PanelAlert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Process stopped');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');

    rerender(<PanelAlert tone="info">Scanning resumed</PanelAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('Scanning resumed');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps toolbar and alert roles under component control', () => {
    const consumerProps = { role: 'presentation' } as const;
    const { rerender } = render(
      <PanelActionBar {...consumerProps} label="Actions">Action</PanelActionBar>,
    );
    expect(screen.getByRole('toolbar', { name: 'Actions' })).toBeInTheDocument();

    rerender(<PanelAlert {...consumerProps} tone="danger">Failure</PanelAlert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Failure');
  });
});

describe('process kind styles', () => {
  it('maps every process kind through the single Badge tone API', () => {
    expect(getProcessKindTone('ai')).toBe('accent');
    expect(getProcessKindTone('ai-ide')).toBe('info');
    expect(getProcessKindTone('custom')).toBe('neutral');
  });
});

describe('icon facade', () => {
  it('keeps UI primitives behind the shared icons module', () => {
    const components = ['Button', 'StateView', 'PanelAlert'];
    for (const component of components) {
      const source = readFileSync(resolve(__dirname, `../src/components/ui/${component}.tsx`), 'utf8');
      expect(source).not.toContain("from 'lucide-react'");
      expect(source).toContain("from '../icons'");
    }
  });
});

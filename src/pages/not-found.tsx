import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'

export function NotFoundPage() {
  return (
    <div className="py-10">
      <EmptyState
        icon={Compass}
        title="That page does not exist"
        description="The link may be out of date. Everything lives behind the five tabs at the bottom."
        action={
          <Button asChild>
            <Link to="/">Go to the dashboard</Link>
          </Button>
        }
      />
    </div>
  )
}

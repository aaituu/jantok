.PHONY: setup setup-demo start stop migrate seed verify verify-stage10 verify-stage11 backup restore

setup:
	./scripts/local.sh setup

setup-demo:
	./scripts/local.sh setup --demo

start:
	./scripts/local.sh start

stop:
	./scripts/local.sh stop

migrate:
	./scripts/local.sh migrate

seed:
	./scripts/local.sh seed

verify:
	./scripts/local.sh verify

verify-stage10:
	./scripts/verify-stage10.sh

verify-stage11:
	./scripts/verify-stage11.sh

backup:
	./scripts/local.sh backup

restore:
	@test -n "$(BACKUP)" || (echo "Use: make restore BACKUP=/absolute/path/to/backup" >&2; exit 1)
	./scripts/local.sh restore "$(BACKUP)" --confirm-local-restore

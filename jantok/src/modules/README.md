# Domain module boundaries

Each child directory is a reserved NestJS module boundary from the approved architecture. A directory receives executable providers/controllers only when its domain is implemented; cross-domain imports go through exported application services rather than repositories. Stage 0 runtime modules (`config`, `database`, `health`) remain under `src/` because they are platform concerns.

## Generates data/brain-norms.js: percentile positions for my FreeSurfer measures
## against the lifespan brain-charts normative models (Bethlehem et al. 2022, Nature).
##
## Usage (Docker, matching the run that produced the committed data file):
##   docker build -t fs-norms-r - <<'EOF'
##   FROM rocker/r-base:4.4.1
##   RUN Rscript -e "install.packages(c('gamlss','jsonlite'), repos='https://cloud.r-project.org')"
##   EOF
##   git clone https://github.com/brainchart/lifespan $HOME/lifespan
##   docker run --rm -v $HOME:/repo fs-norms-r Rscript /repo/brain/analyze_norms.R
## (the script expects the lifespan repo at /repo/lifespan and writes /repo/brain-norms.js;
##  user values below are from FreeSurfer 8.2.0 recon-all stats — update them to re-run)

REPO <- "/repo/lifespan"; setwd(REPO)
for (f in c("100.common-variables.r","101.common-functions.r","102.gamlss-recode.r",
            "300.variables.r","301.functions.r"))
  suppressWarnings(suppressMessages(source(file.path(REPO, f))))

library(jsonlite)

## ---- user values (from FreeSurfer 8.2.0, mm3) ----
USER <- list(
  eTIV       = 1681088.9,
  GMV        = 480846.4,    ## CortexVol
  WMV        = 499310.0,    ## CerebralWhiteMatterVol
  sGMV       = (7098.5+7479.8)+(4009.0+4117.0)+(5779.7+5592.0)+(1785.4+1689.4)+
               (4422.3+4991.9)+(2077.7+2266.7)+(628.8+706.5)+(4325.9+4305.2),
  Ventricles = 19891.0,
  TCV        = 480846.4 + 499310.0,   ## GMV+WMV (cerebrum total cortical volume)
  meanCT     = (2.45422+2.35981)/2,  ## mean of lh/rh MeanThickness (mm)
  totalSA    = 91653.9 + 92095.2,
  ## subcortical L+R totals, mm3
  Thalamus.Proper  = 7098.5+7479.8,
  Caudate          = 4009.0+4117.0,
  Putamen          = 5779.7+5592.0,
  Pallidum         = 1785.4+1689.4,
  Hippocampus      = 4422.3+4991.9,
  Amygdala         = 2077.7+2266.7,
  Accumbens.area   = 628.8+706.5,
  VentralDC        = 4325.9+4305.2
)
## real totalSA from lh+rh white-surface areas (mm2)


## ---- helpers ----
AGE_DAYS <- 365 * 48
newgrid <- function(extra = list()) {
  g <- do.call(expand.grid, c(list(AgeTransformed = log(AGE_DAYS),
                                   sex = factor("Male", levels = c("Female","Male"))), extra))
  g
}

## percentile of user's value vs. population (no study ranef, fs_version at grand mean)
pct.of <- function(fitfile, value) {
  FIT <- readRDS(file.path(REPO, "Share", "RefittedModels", fitfile))
  cov <- attr(FIT$param, "model")$covariates
  Y <- cov$Y
  G <- newgrid()
  G[[Y]] <- value
  R <- Apply.Param(NEWData = G, FITParam = FIT$param, Add.Normalise = TRUE,
                   Add.Derivative = FALSE)
  list(median  = R[[sprintf("PRED.m500.pop")]][1],
       pct     = R[[sprintf("%s.q.pop", Y)]][1],
       params  = list(mu = R[["mu.pop"]][1], sigma = R[["sigma.pop"]][1]))
}

curves.of <- function(fitfile, ages = seq(20, 80, by = 1)) {
  FIT <- readRDS(file.path(REPO, "Share", "RefittedModels", fitfile))
  G <- do.call(expand.grid, list(AgeTransformed = log(365 * ages),
                                 sex = factor("Male", levels = c("Female","Male"))))
  R <- Apply.Param(NEWData = G, FITParam = FIT$param, Add.Derivative = FALSE)
  list(ages = ages,
       lo   = R$PRED.l025.pop, lin = R$PRED.l250.pop, med = R$PRED.m500.pop,
       hiin = R$PRED.u750.pop, hi  = R$PRED.u975.pop)
}

OUT <- list(meta = list(age = 48, sex = "male", family = "GGalt",
             source = "Bethlehem et al. 2022 Nature brain-charts (FS-harmonized to FS6)"),
       composition = list(), global = list(), subcortical = list())

CONV <- function(mm3) mm3 / 1e4   ## mm3 -> model unit (1e-2 L); cm3 = model*10

## ---- composition panels (curves scaled to cm3 = model*10) ----
for (n in c("GMV","WMV","sGMV","Ventricles")) {
  f <- sprintf("FIT_%s.rds", n)
  cv <- curves.of(f)
  cv$lo <- round(cv$lo * 10, 2); cv$lin <- round(cv$lin * 10, 2)
  cv$med <- round(cv$med * 10, 2); cv$hiin <- round(cv$hiin * 10, 2)
  cv$hi <- round(cv$hi * 10, 2)
  p  <- pct.of(f, CONV(USER[[n]]))
  OUT$composition[[n]] <- c(list(user = round(USER[[n]]/1000, 1),
                                 pct = p$pct * 100),
                            cv,
                            median = round(p$median * 10, 1))
  cat(n, " pct:", round(p$pct*100,1), " median_cm3:", round(p$median*10,1),
      " mu:", p$params$mu, "\n")
}

## ---- globals (percentile only) ----
GLOBAL_FILES <- list(eTIV="FIT_eTIVTransformed.gz", TCV="FIT_TCV.rds",
                     meanCT="FIT_meanCT2.rds", totalSA="FIT_totalSA2.rds")
for (key in names(GLOBAL_FILES)) {
  f <- GLOBAL_FILES[[key]]
  val <- if (key == "meanCT") USER$meanCT else if (key == "totalSA") USER$totalSA else USER[[key]]
  v <- val / 10000
  p <- pct.of(f, v)
  OUT$global[[key]] <- list(user = if (grepl("meanCT|totalSA", key)) round(val,2) else round(USER[[key]]/1000, 1),
                            pct = p$pct * 100, median = p$median, param = p$params)
  cat(key, " pct:", round(p$pct*100,1), " median:", p$median, "\n")
}

## ---- subcortical: models are per-hemisphere (each side an observation),
## so percentiles are computed per side against the single-side distribution ----
SIDES <- list(
  list(fs = "Thalamus.Proper",  key = "Thalamus",      lh = 7098.5, rh = 7479.8),
  list(fs = "Caudate",          key = "Caudate",       lh = 4009.0, rh = 4117.0),
  list(fs = "Putamen",          key = "Putamen",       lh = 5779.7, rh = 5592.0),
  list(fs = "Pallidum",         key = "Pallidum",      lh = 1785.4, rh = 1689.4),
  list(fs = "Hippocampus",      key = "Hippocampus",   lh = 4422.3, rh = 4991.9),
  list(fs = "Amygdala",         key = "Amygdala",      lh = 2077.7, rh = 2266.7),
  list(fs = "Accumbens.area",   key = "Accumbens area",lh = 628.8,  rh = 706.5),
  list(fs = "VentralDC",        key = "VentralDC",     lh = 4325.9, rh = 4305.2)
)
for (s in SIDES) {
  f <- sprintf("FIT_%sTransformed.gz", s$fs)
  pl <- tryCatch(pct.of(f, s$lh / 10000), error = function(e) { cat(s$key, "L ERR:", conditionMessage(e), "\n"); NULL })
  pr <- tryCatch(pct.of(f, s$rh / 10000), error = function(e) { cat(s$key, "R ERR:", conditionMessage(e), "\n"); NULL })
  if (!is.null(pl) && !is.null(pr)) {
    OUT$subcortical[[s$key]] <- list(
      l = list(user = round(s$lh/1000, 2), pct = pl$pct * 100),
      r = list(user = round(s$rh/1000, 2), pct = pr$pct * 100),
      median = pl$median * 10)   # per-hemisphere median, cm3
    cat(s$key, " L:", round(pl$pct*100,1), " R:", round(pr$pct*100,1),
        " median_side_cm3:", round(pl$median*10,2), "\n")
  }
}

write_lines <- function(x, path) cat(x, "\n", file = path, sep = "")
js <- capture.output(cat("window.BRAIN_NORMS = ", toJSON(OUT, auto_unbox = TRUE, digits = 6), ";", sep = ""))
writeLines(js, "/repo/brain-norms.js")
cat("WROTE /repo/brain-norms.js\n")
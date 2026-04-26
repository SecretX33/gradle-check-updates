import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile
import org.springframework.boot.gradle.tasks.bundling.BootJar

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.noarg)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
}

group = "com.example.common"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    // Kotlin dependencies
    implementation(libs.kotlin.stdlib)
    implementation(libs.kotlin.reflect)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.slf4j)

    // Database configuration dependencies
    api(libs.spring.boot.starter.data.jpa)
    api(libs.liquibase.core)
    api(libs.postgresql)
    api(libs.hibernate.vector)
    api(libs.hypersistence.utils)

    // Jackson dependencies
    api(platform(libs.jackson.bom))
    api(libs.bundles.jackson)
    // MessagePack dependency with explicit Jackson 2.16.2
    api(libs.jackson.dataformat.msgpack) {
        // Exclude the transitive Jackson dependencies that come with MessagePack
        exclude(group = "com.fasterxml.jackson.core")
        exclude(group = "com.fasterxml.jackson.datatype")
        exclude(group = "com.fasterxml.jackson.module")
    }

    api(platform(libs.opentelemetry.bom))
    api(platform(libs.opentelemetry.instrumentation.bom))
    api(libs.bundles.monitoring)

    // Google maps
    implementation(libs.google.maps.services)
    implementation(libs.google.maps.places)
    implementation(libs.google.maps.routing)
    implementation(libs.libphonenumber)

    // Apache commons
    implementation(libs.commons.csv)
    implementation(libs.commons.lang3)

    // Jsoup
    implementation(libs.jsoup)

    // Slack
    implementation(libs.slack)

    // AWS SDK (api so types are accessible to dependent modules)
    api(libs.aws.sdk.s3)
    api(libs.aws.sdk.sts)
    api(libs.aws.sdk.sqs)
    api(libs.aws.sdk.dynamodb)

    // Caching
    api(libs.spring.boot.starter.data.redis) {
        exclude("io.lettuce")
    }
    implementation(libs.spring.session.data.redis)
    implementation(libs.spring.boot.starter.cache)
    implementation(libs.spring.boot.starter.security)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.webflux)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.jedis)
    implementation(libs.guava)
    implementation(libs.jakarta.persistence.api)
    implementation(libs.browscap)
    api(libs.ipaddress)
    api(libs.caffeine)
    api(libs.geoip2)

    // Arrow
    api(platform(libs.arrow.bom))
    api(libs.arrow.core)
    api(libs.arrow.fx.coroutines)
    api(libs.arrow.resilience)

    annotationProcessor(libs.spring.boot.configuration.processor)

    // Testing
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.spring.boot.starter.test)
}

tasks.named<Jar>("jar") {
    enabled = true
    archiveBaseName.set("common")

    // Optimize Jar creation
    duplicatesStrategy = DuplicatesStrategy.WARN

    // Enable caching for Jar tasks
    outputs.cacheIf { true }
}

tasks.named<BootJar>("bootJar") {
    enabled = false
}

springBoot {
    mainClass.set("none")
}

// Optimize build cache for this module
tasks.withType<JavaCompile>().configureEach {
    options.isFork = true
    options.isIncremental = true

    // Enable caching for Java compilation
    outputs.cacheIf { true }
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.set(listOf(
            "-Xjsr305=strict",
            "-Xannotation-default-target=param-property",
            "-Xno-param-assertions"
        ))
    }

    // Enable caching for Kotlin compilation
    outputs.cacheIf { true }
}

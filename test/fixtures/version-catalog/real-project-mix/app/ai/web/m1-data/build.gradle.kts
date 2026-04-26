import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
    id("java-test-fixtures")
}

group = "com.example.data"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    api(project(":app:common"))
    api(project(":app:content:m5-api"))

    // Cross-module JPA relationships: web DAOs reference content entities
    implementation(project(":app:content:m1-data"))

    // Spring Boot
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.data.redis)
    implementation(libs.liquibase.core)

    // serializable
    implementation(libs.commons.csv)
    implementation(libs.hypersistence.utils)
    implementation(libs.commons.lang3)

    // caching
    implementation(libs.spring.session.data.redis)
    implementation(libs.spring.boot.starter.cache)

    annotationProcessor(libs.spring.boot.configuration.processor)

    // database clients
    runtimeOnly(libs.postgresql)

    // cache clients
    implementation(libs.guava)

    testImplementation(kotlin("test"))
    testFixturesImplementation(libs.kotlin.stdlib)
    testFixturesImplementation(libs.jakarta.persistence.api)
    testFixturesImplementation(project(":app:common"))
    // Cross-module JPA relationships: test fixtures need content entities
    testFixturesImplementation(project(":app:content:m1-data"))
    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.mockk)
    testImplementation(libs.springmockk)
}

tasks.jar {
    enabled = true
    archiveBaseName.set("web-data")
    archiveClassifier.set("")
}

tasks.bootJar {
    enabled = false
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
    outputs.cacheIf { true }
}
